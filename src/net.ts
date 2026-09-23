import {
  SEND_HZ,
  type BoxSize,
  type ClientMessage,
  type MediaRef,
  type PlayerId,
  type ServerMessage,
  type Vec3,
} from "../shared/protocol.ts";
import type { Player } from "./player.ts";

export type NetHandlers = {
  onMessage(msg: ServerMessage): void;
  onStatus(connected: boolean): void;
};

/**
 * WebSocket client. The URL is derived from the page origin, so the same code
 * works in dev (Vite proxies /ws to the game server) and in production.
 * Joining (identity + passphrase) is driven by main.ts on "lobby" messages.
 */
export class Net {
  connected = false;
  joined = false;
  private ws: WebSocket | null = null;
  private acc = 0;

  private handlers: NetHandlers;

  constructor(handlers: NetHandlers) {
    this.handlers = handlers;
  }

  connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.handlers.onStatus(true);
    };
    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.t === "welcome") this.joined = true;
      this.handlers.onMessage(msg);
    };
    ws.onclose = () => {
      this.connected = false;
      this.joined = false;
      this.ws = null;
      this.handlers.onStatus(false);
      setTimeout(() => this.connect(), 2000);
    };
    ws.onerror = () => ws.close();
  }

  private send(msg: ClientMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  join(id: PlayerId, pass: string, create = false) {
    this.send(create ? { t: "join", id, pass, create: true } : { t: "join", id, pass });
  }

  chat(text: string, media?: MediaRef) {
    this.send(media ? { t: "chat", text, media } : { t: "chat", text });
  }

  recall(id: number) {
    this.send({ t: "recall", id });
  }

  rename(name: string) {
    this.send({ t: "rename", name });
  }

  placeBox(draft: {
    size: BoxSize;
    text: string;
    media: MediaRef[];
    announce: boolean;
    loc: string;
    tiles: number[];
    fwd: Vec3;
  }) {
    this.send({ t: "box-place", ...draft });
  }

  openBox(id: number) {
    this.send({ t: "box-open", id });
  }

  keepBox(id: number, label?: string) {
    this.send(label ? { t: "box-keep", id, label } : { t: "box-keep", id });
  }

  labelBox(id: number, label: string) {
    this.send({ t: "box-label", id, label });
  }

  putBox(id: number, loc: string, tiles: number[], fwd: Vec3) {
    this.send({ t: "box-put", id, loc, tiles, fwd });
  }

  /** Called every frame; sends the local state at SEND_HZ once joined. */
  tick(dt: number, player: Player) {
    if (!this.joined) return;
    this.acc += dt;
    if (this.acc < 1 / SEND_HZ) return;
    this.acc = 0;
    const r = (v: number) => Math.round(v * 1000) / 1000;
    const p = player.pos;
    const q = player.quat;
    this.send({
      t: "state",
      p: [r(p.x), r(p.y), r(p.z)],
      q: [r(q.x), r(q.y), r(q.z), r(q.w)],
      m: player.moving ? 1 : 0,
      loc: player.world.id,
      tile: player.tile,
    });
  }
}
