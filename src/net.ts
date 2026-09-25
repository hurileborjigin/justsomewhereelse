import {
  SEND_HZ,
  type BoxContents,
  type BoxSize,
  type ClientMessage,
  type MediaRef,
  type PlayerId,
  type ServerMessage,
  type Track,
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

  join(id: PlayerId, pass: string, create = false, take = false) {
    this.send({ t: "join", id, pass, ...(create ? { create: true } : {}), ...(take ? { take: true } : {}) });
  }

  chat(text: string, media?: MediaRef) {
    this.send(media ? { t: "chat", text, media } : { t: "chat", text });
  }

  recall(id: number) {
    this.send({ t: "recall", id });
  }

  placeBox(msg: { size: BoxSize; contents: BoxContents; announce: boolean; loc: string; tiles: number[]; fwd: Vec3 }) {
    this.send({ t: "box-place", ...msg });
  }

  openBox(id: number) {
    this.send({ t: "box-open", id });
  }

  keepBox(id: number, label?: string) {
    this.send(label ? { t: "box-keep", id, label } : { t: "box-keep", id });
  }

  homeBox(id: number, label?: string) {
    this.send(label ? { t: "box-home", id, label } : { t: "box-home", id });
  }

  labelBox(id: number, label: string) {
    this.send({ t: "box-label", id, label });
  }

  putBox(id: number, loc: string, tiles: number[], fwd: Vec3) {
    this.send({ t: "box-put", id, loc, tiles, fwd });
  }

  deleteBox(id: number) {
    this.send({ t: "box-delete", id });
  }

  editBox(id: number, contents: BoxContents, announce: boolean) {
    this.send({ t: "box-edit", id, contents, announce });
  }

  liftBox(id: number) {
    this.send({ t: "box-lift", id });
  }

  /** `owner` is your own id to claim the building, or null to open it to both. */
  claimBuilding(id: string, owner: PlayerId | null) {
    this.send({ t: "building-claim", id, owner });
  }

  knock(id: string) {
    this.send({ t: "knock", id });
  }

  /** The owner lets the pending knocker in. */
  openDoor(id: string) {
    this.send({ t: "door-open", id });
  }

  musicPlay() {
    this.send({ t: "music-play" });
  }

  /** Ask Spotify to start the current song again on this speaker. */
  musicHear() {
    this.send({ t: "music-hear" });
  }

  musicPause() {
    this.send({ t: "music-pause" });
  }

  musicSeek(positionMs: number) {
    this.send({ t: "music-seek", positionMs });
  }

  musicNext() {
    this.send({ t: "music-next" });
  }

  musicAdd(track: Track) {
    this.send({ t: "music-add", track });
  }

  musicNow(track: Track) {
    this.send({ t: "music-now", track });
  }

  musicDevice(deviceId: string | null, haven = false) {
    this.send(haven ? { t: "music-device", deviceId, haven: true } : { t: "music-device", deviceId });
  }

  musicReport(report: { uri: string | null; paused: boolean; positionMs: number; audible: boolean; track?: Track }) {
    this.send({ t: "music-report", ...report });
  }

  musicConnect() {
    this.send({ t: "music-connect" });
  }

  musicSearch(q: string) {
    this.send({ t: "music-search", q });
  }

  musicPlaylists() {
    this.send({ t: "music-playlists" });
  }

  musicPlaylist(id: string) {
    this.send({ t: "music-playlist", id });
  }

  musicLiked() {
    this.send({ t: "music-liked" });
  }

  musicDevices() {
    this.send({ t: "music-devices" });
  }

  musicToken() {
    this.send({ t: "music-token" });
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
