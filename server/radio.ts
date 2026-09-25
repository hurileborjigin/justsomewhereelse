// Turns music commands into session changes, then tells each Spotify account.
// A failed Spotify call never rewrites the session.

import { randomBytes } from "node:crypto";
import type { MusicView, PlayerId, ServerMessage, Track } from "../shared/protocol.ts";
import { GRACE_MS, MusicRoom, positionAt } from "./music.ts";
import type { Spotify } from "./spotify.ts";
import type { Store } from "./store.ts";

export type Send = (id: PlayerId, msg: ServerMessage) => void;

function isTrack(v: unknown): v is Track {
  if (!v || typeof v !== "object") return false;
  const t = v as Track;
  return (
    typeof t.uri === "string" &&
    t.uri.startsWith("spotify:track:") &&
    typeof t.name === "string" &&
    typeof t.artists === "string" &&
    (t.image === null || typeof t.image === "string") &&
    typeof t.durationMs === "number"
  );
}

export class Radio {
  readonly room = new MusicRoom();
  private access = new Map<PlayerId, { token: string; until: number }>();
  private haven: [string | null, string | null] = [null, null];
  private device: [string | null, string | null] = [null, null];
  private blocked = new Map<PlayerId, string>();
  private notice = new Map<PlayerId, string | null>();
  private states = new Map<string, PlayerId>();
  private leaveTimer: [ReturnType<typeof setTimeout> | null, ReturnType<typeof setTimeout> | null] = [null, null];
  /** What we last asked Spotify to play, so a later sync does not restart the same song. */
  private sent: [{ uri: string | null; paused: boolean } | null, { uri: string | null; paused: boolean } | null] = [null, null];
  private store: Store;
  private spotify: Spotify | null;
  private send: Send;

  constructor(store: Store, spotify: Spotify | null, send: Send) {
    this.store = store;
    this.spotify = spotify;
    this.send = send;
    this.room.sessions[0] = store.musicSession(0);
    this.room.sessions[1] = store.musicSession(1);
  }

  view(id: PlayerId, now = Date.now()): MusicView {
    const shared = this.room.sharedOwner !== null && this.room.onlineAt(0) && this.room.onlineAt(1);
    const owner = shared ? this.room.sharedOwner! : id;
    const session = this.room.sessions[owner];
    const blocked = session.track !== null && this.blocked.get(id) === session.track.uri;
    return {
      connected: this.store.spotifyRefresh(id) !== null,
      shared,
      session: {
        ...session,
        positionMs: positionAt(session, now),
        queue: session.queue.slice(),
      },
      waiting: blocked,
      notice: this.notice.get(id) ?? null,
    };
  }

  publish(now = Date.now()) {
    for (const id of [0, 1] as const) {
      if (!this.room.onlineAt(id)) continue;
      this.send(id, { t: "music", view: this.view(id, now) });
    }
  }

  joined(id: PlayerId, now = Date.now()) {
    this.clearLeave(id);
    this.room.online(id, now);
    this.persist();
    this.publish(now);
    void this.sync(now);
  }

  /** The socket dropped. Music waits out the grace before it counts as leaving. */
  disconnected(id: PlayerId, now = Date.now()) {
    this.room.offline(id, now);
    this.clearLeave(id);
    this.leaveTimer[id] = setTimeout(() => {
      this.leaveTimer[id] = null;
      this.room.apply({ t: "tick", now: Date.now() }, Date.now());
      this.persist();
      this.publish();
      void this.pause(id);
      void this.sync();
    }, GRACE_MS);
  }

  connectUrl(id: PlayerId): string | null {
    if (!this.spotify) return null;
    const state = randomBytes(16).toString("hex");
    this.states.set(state, id);
    return this.spotify.authUrl(state);
  }

  async callback(code: string, state: string): Promise<boolean> {
    const id = this.states.get(state);
    this.states.delete(state);
    if (id === undefined || !this.spotify) return false;
    const tokens = await this.spotify.exchange(code);
    if (!tokens.ok || !tokens.value.refresh) return false;
    this.store.setSpotifyRefresh(id, tokens.value.refresh);
    this.access.set(id, { token: tokens.value.access, until: Date.now() + tokens.value.expiresIn * 1000 });
    this.notice.set(id, null);
    this.publish();
    return true;
  }

  async token(id: PlayerId): Promise<string | null> {
    return this.ensure(id);
  }

  /** Forget the last command and send play, so a silent speaker actually starts. */
  hear(id: PlayerId, now = Date.now()) {
    this.sent[id] = null;
    void this.sync(now, false);
  }

  command(id: PlayerId, kind: "play" | "pause" | "next", now = Date.now()) {
    this.room.apply({ t: kind, by: id }, now);
    this.after(now, true);
  }

  seek(id: PlayerId, positionMs: number, now = Date.now()) {
    this.room.apply({ t: "seek", by: id, positionMs }, now);
    this.after(now, true);
  }

  add(id: PlayerId, track: unknown, now = Date.now()) {
    if (!isTrack(track)) return;
    this.room.apply({ t: "add", by: id, track }, now);
    this.persist();
    this.publish(now);
  }

  now(id: PlayerId, track: unknown, nowMs = Date.now()) {
    if (!isTrack(track)) return;
    this.room.apply({ t: "play-now", by: id, track }, nowMs);
    this.after(nowMs);
  }

  setDevice(id: PlayerId, deviceId: string | null, haven = false) {
    if (haven && deviceId) this.haven[id] = deviceId;
    const next = deviceId ?? this.haven[id];
    const same = next === this.device[id];
    this.device[id] = next;
    if (this.device[id] && this.notice.get(id) === "No speaker") this.notice.set(id, null);
    this.publish();
    if (!same) void this.sync(Date.now(), true);
  }

  async report(id: PlayerId, actual: { uri: string | null; paused: boolean; positionMs: number; audible: boolean; track?: Track }, now = Date.now()) {
    if (!actual.audible) return;
    const effect = this.room.report(id, actual, now);
    if (effect.do === "seek" && effect.positionMs !== undefined) {
      const device = this.device[id];
      const access = await this.ensure(id);
      if (device && access && this.spotify) await this.spotify.seek(access, device, effect.positionMs);
      return;
    }
    if (effect.do === "follow") this.after(now);
  }

  async search(id: PlayerId, q: string) {
    const access = await this.ensure(id);
    if (!access || !this.spotify) return;
    const got = await this.spotify.search(access, q.slice(0, 80));
    if (got.ok) this.send(id, { t: "music-catalog", catalog: { kind: "search", tracks: got.value } });
    else this.fail(id, got.reason);
  }

  async playlists(id: PlayerId) {
    const access = await this.ensure(id);
    if (!access || !this.spotify) return;
    const got = await this.spotify.playlists(access);
    if (got.ok) this.send(id, { t: "music-catalog", catalog: { kind: "playlists", playlists: got.value } });
    else this.fail(id, got.reason);
  }

  async playlist(id: PlayerId, playlistId: string) {
    const access = await this.ensure(id);
    if (!access || !this.spotify) return;
    const got = await this.spotify.playlist(access, playlistId);
    if (got.ok) this.send(id, { t: "music-catalog", catalog: { kind: "playlist", tracks: got.value } });
    else this.fail(id, got.reason);
  }

  async liked(id: PlayerId) {
    const access = await this.ensure(id);
    if (!access || !this.spotify) return;
    const got = await this.spotify.liked(access);
    if (got.ok) this.send(id, { t: "music-catalog", catalog: { kind: "liked", tracks: got.value } });
    else this.fail(id, got.reason);
  }

  async devices(id: PlayerId) {
    const access = await this.ensure(id);
    if (!access || !this.spotify) return;
    const got = await this.spotify.devices(access);
    if (got.ok) this.send(id, { t: "music-devices", devices: got.value });
    else this.fail(id, got.reason);
  }

  private after(now: number, place = false) {
    this.persist();
    this.publish(now);
    void this.sync(now, place);
  }

  private persist() {
    this.store.saveMusicSession(0, this.room.sessions[0]);
    this.store.saveMusicSession(1, this.room.sessions[1]);
  }

  private clearLeave(id: PlayerId) {
    const timer = this.leaveTimer[id];
    if (timer) clearTimeout(timer);
    this.leaveTimer[id] = null;
  }

  private fail(id: PlayerId, reason: "unavailable" | "premium" | "auth" | "failed") {
    if (reason === "premium") this.notice.set(id, "Spotify Premium is required");
    else if (reason === "auth") this.notice.set(id, null);
    else this.notice.set(id, "Spotify did not answer");
    if (reason === "auth") this.access.delete(id);
    this.send(id, { t: "music-deny", reason: reason === "premium" ? "premium" : "spotify" });
    this.publish();
  }

  private async ensure(id: PlayerId): Promise<string | null> {
    const cached = this.access.get(id);
    if (cached && cached.until > Date.now() + 30_000) return cached.token;
    const refresh = this.store.spotifyRefresh(id);
    if (!refresh || !this.spotify) return null;
    const got = await this.spotify.refresh(refresh);
    if (!got.ok) {
      this.notice.set(id, null);
      this.store.setSpotifyRefresh(id, null);
      this.send(id, { t: "music-deny", reason: "spotify" });
      return null;
    }
    if (got.value.refresh) this.store.setSpotifyRefresh(id, got.value.refresh);
    this.access.set(id, { token: got.value.access, until: Date.now() + got.value.expiresIn * 1000 });
    return got.value.access;
  }

  private async pause(id: PlayerId) {
    const device = this.device[id];
    const access = await this.ensure(id);
    if (!device || !access || !this.spotify) return;
    await this.spotify.pause(access, device);
  }

  private async sync(now = Date.now(), place = false) {
    for (const id of [0, 1] as const) {
      if (!this.room.onlineAt(id)) continue;
      const device = this.device[id];
      if (!device) continue;
      const heard = this.room.hear(id, now, this.blocked.get(id) !== this.room.sessions[this.room.sharedOwner ?? id]?.track?.uri);
      const uri = heard.track?.uri ?? null;
      const paused = !heard.track || heard.paused;
      const previous = this.sent[id];
      const sameSong = previous?.uri === uri && previous.paused === paused;
      if (paused) {
        if (sameSong) continue;
        const access = await this.ensure(id);
        if (access && this.spotify) await this.spotify.pause(access, device);
        this.sent[id] = { uri, paused: true };
        continue;
      }
      if (!heard.track) continue;
      const access = await this.ensure(id);
      if (!access || !this.spotify) continue;
      const listed = await this.spotify.speakers(access);
      let speaker = device;
      if (listed.ok) {
        const known = listed.value.find((d) => d.id === device) ?? listed.value.find((d) => d.name === "Haven");
        if (known) {
          speaker = known.id;
          this.device[id] = speaker;
        }
      }
      const at = heard.track.durationMs > 0 ? Math.min(heard.positionMs, heard.track.durationMs - 1) : 0;
      const result = await this.spotify.play(access, speaker, heard.track.uri, at);
      if (result.ok) {
        this.blocked.delete(id);
        if (this.notice.get(id) === "Spotify did not answer" || this.notice.get(id) === "No speaker") this.notice.set(id, null);
      } else if (result.reason === "premium" || result.reason === "auth") {
        this.fail(id, result.reason);
      }
    }
    this.publish(now);
  }
}
