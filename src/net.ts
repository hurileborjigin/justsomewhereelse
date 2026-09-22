import { SEND_HZ, type ClientMessage, type ServerMessage } from "../shared/protocol.ts";
import type { Player } from "./player.ts";

export type NetHandlers = {
  onMessage(msg: ServerMessage): void;
  onStatus(connected: boolean): void;
};

/**
 * WebSocket client. The URL is derived from the page origin, so the same code
 * works in dev (Vite proxies /ws to the game server) and in production.
 */
export class Net {
  connected = false;
  private ws: WebSocket | null = null;
  private acc = 0;
  private rejected = false; // server said "full" - stop reconnecting

  constructor(private handlers: NetHandlers) {}

  connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.handlers.onStatus(true);
      this.send({ t: "hello" });
    };
    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.t === "full") this.rejected = true;
      this.handlers.onMessage(msg);
    };
    ws.onclose = () => {
      this.connected = false;
      this.ws = null;
      this.handlers.onStatus(false);
      if (!this.rejected) setTimeout(() => this.connect(), 2000);
    };
    ws.onerror = () => ws.close();
  }

  private send(msg: ClientMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  swap() {
    this.send({ t: "swap" });
  }

  chat(text: string) {
    this.send({ t: "chat", text });
  }

  /** Called every frame; sends the local state at SEND_HZ. */
  tick(dt: number, player: Player) {
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
    });
  }
}
