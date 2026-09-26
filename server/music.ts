// Session rules for the two personal Spotify sessions. No network.
// The shared session is one player's personal session, mutated in place.
// The other session stays frozen until they are alone again.

import type { MusicSession, PlayerId, Repeat, Track } from "../shared/protocol.ts";

export const DRIFT_MS = 2_000;
export const GRACE_MS = 10_000;

export type { Track };
export type Session = MusicSession;

function looksLikeId(name: string): boolean {
  return name.startsWith("spotify:track:");
}

function titled(track: Track | null | undefined): Track | undefined {
  if (!track || looksLikeId(track.name)) return undefined;
  return track;
}

export type MusicCommand =
  | { t: "play"; by: PlayerId }
  | { t: "pause"; by: PlayerId }
  | { t: "seek"; by: PlayerId; positionMs: number }
  | { t: "next"; by: PlayerId }
  | { t: "add"; by: PlayerId; track: Track }
  | { t: "drop"; by: PlayerId; index: number }
  | { t: "repeat"; by: PlayerId }
  | { t: "play-now"; by: PlayerId; track: Track }
  | { t: "tick"; now: number };

export type Hear = {
  track: Track | null;
  paused: boolean;
  positionMs: number;
  waiting: boolean;
};

export type Effect = { id: PlayerId; do: "pause" | "seek" | "follow" | "ok"; positionMs?: number };

export const emptySession = (): Session => ({
  track: null,
  paused: true,
  positionMs: 0,
  at: 0,
  queue: [],
  repeat: "off",
});

const NEXT_REPEAT: Record<Repeat, Repeat> = { off: "all", all: "one", one: "off" };

export function positionAt(session: Session, now: number): number {
  if (!session.track || session.paused) return session.positionMs;
  return session.positionMs + Math.max(0, now - session.at);
}

const other = (id: PlayerId): PlayerId => (id === 0 ? 1 : 0);

export class MusicRoom {
  sessions: [Session, Session] = [emptySession(), emptySession()];
  sharedOwner: PlayerId | null = null;
  lastEffects: Effect[] = [];
  private flags: [boolean, boolean] = [false, false];
  private leftAt: [number | null, number | null] = [null, null];
  /** Position captured when this player's session was frozen by a share. */
  private held: [number | null, number | null] = [null, null];

  onlineAt(id: PlayerId): boolean {
    return this.flags[id];
  }

  online(id: PlayerId, now: number): void {
    const returning = this.leftAt[id] !== null && now < this.leftAt[id]! + GRACE_MS;
    this.leftAt[id] = null;
    this.flags[id] = true;
    if (returning) return;
    const peer = other(id);
    if (!this.flags[peer]) {
      this.sharedOwner = null;
      return;
    }
    const anchor = this.sessions[peer];
    if (anchor.track && !anchor.paused) {
      this.sharedOwner = peer;
      this.hold(id, now);
    } else {
      this.sharedOwner = null;
    }
  }

  offline(id: PlayerId, now: number): void {
    if (!this.flags[id]) return;
    this.leftAt[id] = now;
  }

  apply(cmd: MusicCommand, now: number): void {
    this.expire(now);
    if (cmd.t === "tick") {
      if (this.sharedOwner !== null && this.both()) this.advance(this.sessions[this.sharedOwner], now);
      else {
        if (this.flags[0]) this.advance(this.sessions[0], now);
        if (this.flags[1]) this.advance(this.sessions[1], now);
      }
      return;
    }
    const owner = this.liveOwner(cmd.by);
    const session = this.sessions[owner];
    this.advance(session, now);
    if (cmd.t === "play") this.play(owner, now);
    else if (cmd.t === "pause") this.pause(session, now);
    else if (cmd.t === "seek") this.seek(session, cmd.positionMs, now);
    else if (cmd.t === "next") this.skip(session, now);
    else if (cmd.t === "add") session.queue.push(cmd.track);
    else if (cmd.t === "drop") session.queue.splice(cmd.index, 1);
    else if (cmd.t === "repeat") session.repeat = NEXT_REPEAT[session.repeat] ?? "off";
    else if (cmd.t === "play-now") this.start(owner, cmd.track, now);
  }

  hear(id: PlayerId, now: number, canPlay = true): Hear {
    const owner = this.sharedOwner !== null && this.flags[0] && this.flags[1] ? this.sharedOwner : id;
    const session = this.sessions[owner];
    return {
      track: session.track,
      paused: session.paused,
      positionMs: Math.min(positionAt(session, now), session.track?.durationMs ?? 0),
      waiting: session.track !== null && !canPlay,
    };
  }

  /**
   * A speaker report. A different track or pause flag is adopted.
   * The same song keeps playing: the clock follows the speaker, and Haven does not seek.
   * Seeking a speaker that is only a little behind restarts the buffer and the gap comes back.
   */
  report(id: PlayerId, actual: { uri: string | null; paused: boolean; positionMs: number; track?: Track }, now: number): Effect {
    const owner = this.sharedOwner !== null && this.flags[0] && this.flags[1] ? this.sharedOwner : id;
    const session = this.sessions[owner];
    if (!actual.uri) return { id, do: "ok" };
    const named = titled(actual.track) ?? titled(session.track?.uri === actual.uri ? session.track : null) ?? session.queue.find((t) => t.uri === actual.uri && titled(t));
    if (actual.uri !== session.track?.uri) {
      if (actual.paused) return { id, do: "ok" };
      session.track = named ?? {
        uri: actual.uri,
        name: "Unknown song",
        artists: "",
        image: null,
        durationMs: 180_000,
      };
      session.positionMs = actual.positionMs;
      session.at = now;
      session.paused = actual.paused;
      return { id, do: "follow" };
    }
    if (named && session.track && looksLikeId(session.track.name)) {
      session.track = named;
      return { id, do: "follow" };
    }
    if (actual.paused && session.track && atEnd(actual.positionMs, session.track.durationMs)) {
      this.finish(session, now);
      return { id, do: "follow" };
    }
    if (actual.paused !== session.paused) {
      session.paused = actual.paused;
      session.positionMs = actual.positionMs;
      session.at = now;
      return { id, do: "follow" };
    }
    session.positionMs = actual.positionMs;
    session.at = now;
    return { id, do: "ok" };
  }

  private hold(id: PlayerId, now: number): void {
    const session = this.sessions[id];
    const position = positionAt(session, now);
    this.held[id] = position;
    session.positionMs = position;
    session.at = now;
  }

  private release(id: PlayerId, now: number): void {
    const position = this.held[id];
    if (position === null) return;
    const session = this.sessions[id];
    session.positionMs = position;
    session.at = now;
    this.held[id] = null;
  }

  private both(): boolean {
    return this.flags[0] && this.flags[1];
  }

  /** Whose personal session a command writes. */
  private liveOwner(by: PlayerId): PlayerId {
    if (this.sharedOwner !== null && this.both()) return this.sharedOwner;
    return by;
  }

  private expire(now: number): void {
    for (const id of [0, 1] as const) {
      const at = this.leftAt[id];
      if (at === null || now < at + GRACE_MS) continue;
      this.leftAt[id] = null;
      this.flags[id] = false;
      if (this.sharedOwner !== null) {
        if (this.sharedOwner === id) this.release(other(id), now);
        this.sharedOwner = null;
        this.held[id] = null;
        this.lastEffects = [{ id, do: "pause" }];
      }
    }
  }

  private play(owner: PlayerId, now: number): void {
    const session = this.sessions[owner];
    if (!session.track) {
      const next = session.queue.shift();
      if (!next) return;
      this.start(owner, next, now);
      return;
    }
    if (!session.paused) return;
    session.paused = false;
    session.at = now;
    if (this.both() && this.sharedOwner === null) this.sharedOwner = owner;
  }

  private start(owner: PlayerId, track: Track, now: number): void {
    const session = this.sessions[owner];
    session.track = track;
    session.paused = false;
    session.positionMs = 0;
    session.at = now;
    if (this.both() && this.sharedOwner === null) this.sharedOwner = owner;
  }

  private pause(session: Session, now: number): void {
    if (!session.track || session.paused) return;
    session.positionMs = positionAt(session, now);
    session.paused = true;
    session.at = now;
  }

  private seek(session: Session, positionMs: number, now: number): void {
    if (!session.track) return;
    const max = session.track.durationMs;
    session.positionMs = Math.max(0, Math.min(max, positionMs));
    session.at = now;
  }

  private skip(session: Session, now: number): void {
    const next = session.queue.shift();
    if (!next) {
      session.track = null;
      session.paused = true;
      session.positionMs = 0;
      session.at = now;
      return;
    }
    session.track = next;
    session.paused = false;
    session.positionMs = 0;
    session.at = now;
  }

  private advance(session: Session | null, now: number): void {
    if (!session) return;
    let guard = 0;
    while (session.track && !session.paused && positionAt(session, now) >= session.track.durationMs && guard < 20) {
      guard += 1;
      this.finish(session, now);
    }
  }

  /** The current song has ended. Repeat decides whether it starts again, goes to the back, or stops. */
  private finish(session: Session, now: number): void {
    const done = session.track;
    if (!done) return;
    if (session.repeat === "one") {
      session.positionMs = 0;
      session.paused = false;
      session.at = now;
      return;
    }
    if (session.repeat === "all") session.queue.push(done);
    const next = session.queue.shift();
    if (!next) {
      session.track = null;
      session.paused = true;
      session.positionMs = 0;
      session.at = now;
      return;
    }
    session.track = next;
    session.paused = false;
    session.positionMs = 0;
    session.at = now;
  }
}

function atEnd(positionMs: number, durationMs: number): boolean {
  return durationMs > 0 && positionMs >= durationMs - 800;
}
