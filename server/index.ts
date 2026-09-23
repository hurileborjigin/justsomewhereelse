// Tiny Planet game server: two named identities (renameable), a shared
// passphrase, and persistence - last position, character assignment and chat
// history live in SQLite so the world survives restarts and you resume where
// you left off. It relays state between the two players and never simulates.
// Runs directly with Node >= 23 (type stripping): `node server/index.ts`.
//
// Env: PORT (default 3001), PLANET_PASS (the shared passphrase - set a real
// secret in production, e.g. `fly secrets set PLANET_PASS=...`), DB_PATH.
import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sirv from "sirv";
import { WebSocketServer, type WebSocket } from "ws";
import {
  BOX_LABEL_MAX_LEN,
  BOX_MEDIA_MAX,
  BOX_TEXT_MAX_LEN,
  CHAT_MAX_LEN,
  MEDIA_MAX_BYTES,
  NAME_MAX_LEN,
  PASS_MIN_LEN,
  RECALL_WINDOW_MS,
  SETUP_CREATOR,
  boxTileCount,
} from "../shared/protocol.ts";
import type {
  Box,
  BoxDenyReason,
  BoxSize,
  ClientMessage,
  MediaRef,
  PlayerId,
  ServerMessage,
  StateData,
  Vec3,
} from "../shared/protocol.ts";
import { Store, type FullBox } from "./store.ts";

const PORT = Number(process.env.PORT ?? 3001);
// PLANET_OPEN=1 disables the passphrase entirely: pick a name, walk in.
// Otherwise: if PLANET_PASS is set it acts as a fixed passphrase (handy for
// dev/tests); else the secret word is chosen in-game by identity 0 on the
// first visit and stored (hashed) in the database.
const OPEN = process.env.PLANET_OPEN === "1";
const ENV_PASS = process.env.PLANET_PASS ?? null;
const DB_PATH = process.env.DB_PATH ?? "data/planet.db";

const store = new Store(DB_PATH);

const distDir = fileURLToPath(new URL("../dist", import.meta.url));
const serveStatic = existsSync(distDir) ? sirv(distDir, { single: true }) : null;

// chat photos & videos live next to the database (the Fly volume in prod)
const MEDIA_DIR =
  process.env.MEDIA_PATH ?? join(DB_PATH === ":memory:" ? "data" : dirname(DB_PATH), "media");
mkdirSync(MEDIA_DIR, { recursive: true });

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};
const EXT_TO_MIME = Object.fromEntries(Object.entries(MIME_TO_EXT).map(([m, e]) => [e, m]));

function handleUpload(req: IncomingMessage, res: ServerResponse) {
  if (!validPass(String(req.headers["x-planet-pass"] ?? ""))) {
    res.statusCode = 403;
    res.end("wrong secret word");
    return;
  }
  const type = String(req.headers["content-type"] ?? "");
  const ext = MIME_TO_EXT[type];
  if (!ext) {
    res.statusCode = 415;
    res.end("only photos and videos");
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  let aborted = false;
  req.on("data", (c: Buffer) => {
    size += c.length;
    if (size > MEDIA_MAX_BYTES && !aborted) {
      aborted = true;
      res.statusCode = 413;
      res.end("too big (max 25 MB)");
      req.destroy();
      return;
    }
    if (!aborted) chunks.push(c);
  });
  req.on("end", () => {
    if (aborted) return;
    const name = `${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
    writeFileSync(join(MEDIA_DIR, name), Buffer.concat(chunks));
    res.setHeader("content-type", "application/json");
    const media: MediaRef = { url: `/media/${name}`, kind: type.startsWith("video") ? "video" : "image" };
    res.end(JSON.stringify(media));
    console.log(`[planet] media uploaded: ${name} (${(size / 1024).toFixed(0)} KB)`);
  });
}

function serveMedia(req: IncomingMessage, res: ServerResponse) {
  const name = (req.url ?? "").slice("/media/".length);
  const file = join(MEDIA_DIR, name);
  if (!/^[\w.-]+$/.test(name) || !existsSync(file)) {
    res.statusCode = 404;
    res.end("not found");
    return;
  }
  res.setHeader("content-type", EXT_TO_MIME[name.split(".").pop() ?? ""] ?? "application/octet-stream");
  res.setHeader("cache-control", "public, max-age=31536000, immutable");
  createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  if (req.url === "/media" && req.method === "POST") return handleUpload(req, res);
  if (req.url?.startsWith("/media/") && req.method === "GET") return serveMedia(req, res);
  if (serveStatic) {
    serveStatic(req, res, () => {
      res.statusCode = 404;
      res.end("not found");
    });
  } else {
    res.statusCode = 200;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end("Tiny Planet game server is running. In dev, open the Vite URL instead.");
  }
});

type Conn = { ws: WebSocket; alive: boolean; live: StateData | null; lastSave: number };
const conns = new Map<PlayerId, Conn>();

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function sendTo(id: PlayerId, msg: ServerMessage) {
  const c = conns.get(id);
  if (c) send(c.ws, msg);
}

function broadcast(msg: ServerMessage) {
  for (const c of conns.values()) send(c.ws, msg);
}

// ---- treasure boxes ---------------------------------------------------------

/** What `viewer` may see of a box: contents only for the creator, or once opened. */
function viewOf(box: FullBox, viewer: PlayerId): Box {
  const { text, media, ...rest } = box;
  return box.creator === viewer || box.opened !== null ? { ...rest, text, media } : rest;
}

function broadcastBox(box: FullBox) {
  for (const [pid, c] of conns) send(c.ws, { t: "box", box: viewOf(box, pid) });
}

const isVec3 = (v: unknown): v is Vec3 =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));

const isMediaRef = (m: unknown): m is MediaRef =>
  typeof m === "object" &&
  m !== null &&
  typeof (m as MediaRef).url === "string" &&
  /^\/media\/[\w.-]+$/.test((m as MediaRef).url) &&
  ((m as MediaRef).kind === "image" || (m as MediaRef).kind === "video");

const isSize = (s: unknown): s is BoxSize => s === "s" || s === "m" || s === "l";

/** Footprint SHAPE only; terrain is the clients' job (both share the seeded world). */
function validFootprint(size: BoxSize, tiles: unknown): tiles is number[] {
  if (!Array.isArray(tiles) || tiles.length !== boxTileCount(size)) return false;
  if (!tiles.every((t) => Number.isInteger(t) && t >= 0)) return false;
  return new Set(tiles).size === tiles.length;
}

/** The partner's tile in `loc`: live when online, else the persisted one; -1 when elsewhere. */
function partnerTileIn(partner: PlayerId, loc: string): number {
  const state = conns.get(partner)?.live ?? store.state(partner);
  return state && state.loc === loc ? state.tile : -1;
}

/** Why a footprint can't stand here, or null when it can. */
function placementDenial(me: PlayerId, loc: string, tiles: number[]): BoxDenyReason | null {
  if (tiles.includes(partnerTileIn((1 - me) as PlayerId, loc))) return "partner";
  const taken = new Set(store.boxesIn(loc).flatMap((b) => b.tiles));
  return tiles.some((t) => taken.has(t)) ? "overlap" : null;
}

const cleanLabel = (raw: unknown) => String(raw ?? "").slice(0, BOX_LABEL_MAX_LEN).trim() || null;

const online = (): [boolean, boolean] => [conns.has(0), conns.has(1)];
const setupMode = () => !OPEN && ENV_PASS === null && !store.hasPass();
const validPass = (pass: string) =>
  OPEN || (ENV_PASS !== null ? pass === ENV_PASS : store.checkPass(pass));

const wss = new WebSocketServer({ server, path: "/ws" });

const lobbyMsg = (): ServerMessage => ({
  t: "lobby",
  names: store.names(),
  online: online(),
  setup: setupMode(),
  open: OPEN,
});

/** Anyone still on the login screen gets a fresh lobby (names/online/setup). */
function refreshLobbies() {
  const joined = new Set([...conns.values()].map((c) => c.ws));
  for (const client of wss.clients) {
    if (!joined.has(client as WebSocket)) send(client as WebSocket, lobbyMsg());
  }
}

wss.on("connection", (ws) => {
  let id: PlayerId | null = null;

  send(ws, lobbyMsg());

  ws.on("message", (data) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (msg.t === "join") {
      if (id !== null) return;
      const wanted: PlayerId = msg.id === 0 ? 0 : 1;
      const pass = String(msg.pass ?? "");
      if (msg.create && !OPEN) {
        // first-visit setup: only the designated identity may choose the word
        if (!setupMode()) {
          send(ws, { t: "deny", reason: "exists" });
          return;
        }
        if (wanted !== SETUP_CREATOR || pass.length < PASS_MIN_LEN) {
          send(ws, { t: "deny", reason: wanted !== SETUP_CREATOR ? "setup" : "pass" });
          return;
        }
        store.setPass(pass);
        console.log(`[planet] ${store.names()[wanted]} chose the secret word`);
      } else {
        if (setupMode()) {
          send(ws, { t: "deny", reason: "setup" });
          return;
        }
        if (!validPass(pass)) {
          send(ws, { t: "deny", reason: "pass" });
          return;
        }
      }
      if (conns.has(wanted)) {
        send(ws, { t: "deny", reason: "taken" });
        return;
      }
      id = wanted;
      conns.set(id, { ws, alive: true, live: null, lastSave: 0 });
      const peerId = (1 - id) as PlayerId;
      const peerConn = conns.get(peerId);
      send(ws, {
        t: "welcome",
        id,
        names: store.names(),
        state: store.state(id),
        peer: {
          online: !!peerConn,
          state: peerConn ? (peerConn.live ?? store.state(peerId)) : null,
        },
        history: store.history(200),
        boxes: store.boxes().map((b) => viewOf(b, wanted)),
      });
      sendTo(peerId, { t: "peer-joined", id });
      refreshLobbies();
      console.log(`[planet] ${store.names()[id]} (${id}) joined`);
      return;
    }

    if (id === null) return; // everything below requires a joined identity
    const me = conns.get(id);
    if (!me) return;

    if (msg.t === "state") {
      const state: StateData = { p: msg.p, q: msg.q, m: msg.m, loc: msg.loc ?? "globe", tile: msg.tile ?? 0 };
      const locChanged = me.live !== null && me.live.loc !== state.loc;
      me.live = state;
      // persist on world change immediately, otherwise at most every 2s
      const now = Date.now();
      if (locChanged || now - me.lastSave > 2000) {
        store.saveState(id, state);
        me.lastSave = now;
      }
      sendTo((1 - id) as PlayerId, { t: "state", id, ...state });
    } else if (msg.t === "chat") {
      const text = String(msg.text ?? "").slice(0, CHAT_MAX_LEN).trim();
      let media: MediaRef | undefined;
      if (
        msg.media &&
        typeof msg.media.url === "string" &&
        /^\/media\/[\w.-]+$/.test(msg.media.url) &&
        (msg.media.kind === "image" || msg.media.kind === "video")
      ) {
        media = { url: msg.media.url, kind: msg.media.kind };
      }
      if (!text && !media) return;
      const entry = store.addMessage(id, text, media);
      // echo to the sender too: the id it carries is what makes recall work
      broadcast({ t: "chat", ...entry });
    } else if (msg.t === "recall") {
      const mid = Number(msg.id);
      const m = store.getMessage(mid);
      if (!m || m.sender !== id || Date.now() - m.ts > RECALL_WINDOW_MS) return;
      store.deleteMessage(mid);
      if (m.media) {
        const name = m.media.url.split("/").pop() ?? "";
        if (/^[\w.-]+$/.test(name)) {
          try {
            unlinkSync(join(MEDIA_DIR, name));
          } catch {
            /* already gone */
          }
        }
      }
      broadcast({ t: "recalled", id: mid });
      console.log(`[planet] ${store.names()[id]} recalled message ${mid}`);
    } else if (msg.t === "rename") {
      const name = String(msg.name ?? "").slice(0, NAME_MAX_LEN).trim();
      if (!name) return;
      store.rename(id, name);
      broadcast({ t: "names", names: store.names() });
      refreshLobbies();
      console.log(`[planet] player ${id} renamed to ${name}`);
    } else if (msg.t === "box-place") {
      const text = String(msg.text ?? "").slice(0, BOX_TEXT_MAX_LEN).trim();
      const media = Array.isArray(msg.media) ? msg.media.filter(isMediaRef).slice(0, BOX_MEDIA_MAX) : [];
      const loc = String(msg.loc ?? "");
      if (
        !isSize(msg.size) ||
        !validFootprint(msg.size, msg.tiles) ||
        !isVec3(msg.fwd) ||
        !loc ||
        (!text && media.length === 0)
      ) {
        send(ws, { t: "box-deny", reason: "invalid" });
        return;
      }
      const denial = placementDenial(id, loc, msg.tiles);
      if (denial) {
        send(ws, { t: "box-deny", reason: denial });
        return;
      }
      const box = store.addBox({
        creator: id,
        size: msg.size,
        text,
        media,
        announce: !!msg.announce,
        loc,
        tiles: msg.tiles,
        fwd: msg.fwd,
      });
      broadcastBox(box);
      console.log(`[planet] ${store.names()[id]} left a ${box.size.toUpperCase()} treasure box #${box.id} in ${loc}`);
    } else if (msg.t === "box-open") {
      const box = store.getBox(Number(msg.id));
      if (!box) {
        send(ws, { t: "box-deny", reason: "missing" });
        return;
      }
      if (box.opened === null && box.creator !== id) {
        store.openBox(box.id, Date.now());
        broadcastBox(store.getBox(box.id)!);
        console.log(`[planet] ${store.names()[id]} opened treasure box #${box.id}`);
      } else {
        send(ws, { t: "box", box: viewOf(box, id) });
      }
    } else if (msg.t === "box-keep") {
      const box = store.getBox(Number(msg.id));
      if (!box) {
        send(ws, { t: "box-deny", reason: "missing" });
        return;
      }
      if (box.creator === id) {
        send(ws, { t: "box-deny", reason: "creator" });
        return;
      }
      if (box.loc === null) {
        send(ws, { t: "box-deny", reason: "missing" }); // not standing anywhere
        return;
      }
      store.keepBox(box.id, id, cleanLabel(msg.label) ?? box.label);
      broadcastBox(store.getBox(box.id)!);
      console.log(`[planet] ${store.names()[id]} kept treasure box #${box.id}`);
    } else if (msg.t === "box-label") {
      const box = store.getBox(Number(msg.id));
      if (!box) {
        send(ws, { t: "box-deny", reason: "missing" });
        return;
      }
      if (box.owner !== id) {
        send(ws, { t: "box-deny", reason: "owner" });
        return;
      }
      store.labelBox(box.id, cleanLabel(msg.label));
      broadcastBox(store.getBox(box.id)!);
    } else if (msg.t === "box-put") {
      const box = store.getBox(Number(msg.id));
      if (!box) {
        send(ws, { t: "box-deny", reason: "missing" });
        return;
      }
      if (box.owner !== id) {
        send(ws, { t: "box-deny", reason: "owner" });
        return;
      }
      const loc = String(msg.loc ?? "");
      if (box.loc !== null || !loc || !validFootprint(box.size, msg.tiles) || !isVec3(msg.fwd)) {
        send(ws, { t: "box-deny", reason: "invalid" });
        return;
      }
      const denial = placementDenial(id, loc, msg.tiles);
      if (denial) {
        send(ws, { t: "box-deny", reason: denial });
        return;
      }
      store.putBox(box.id, loc, msg.tiles, msg.fwd);
      broadcastBox(store.getBox(box.id)!);
      console.log(`[planet] ${store.names()[id]} placed treasure box #${box.id} in ${loc}`);
    }
  });

  ws.on("pong", () => {
    if (id !== null) {
      const c = conns.get(id);
      if (c) c.alive = true;
    }
  });

  ws.on("close", () => {
    if (id === null) return;
    const c = conns.get(id);
    if (c?.ws !== ws) return;
    if (c.live) store.saveState(id, c.live);
    conns.delete(id);
    sendTo((1 - id) as PlayerId, { t: "peer-left", id });
    refreshLobbies();
    console.log(`[planet] ${store.names()[id]} (${id}) left`);
  });
});

setInterval(() => {
  for (const c of conns.values()) {
    if (!c.alive) {
      c.ws.terminate();
      continue;
    }
    c.alive = false;
    c.ws.ping();
  }
}, 30_000);

server.listen(PORT, () => {
  console.log(`[planet] listening on http://localhost:${PORT} (ws path /ws, db ${DB_PATH})`);
  if (setupMode()) console.log("[planet] no secret word yet - the first visit sets it up in-game");
  if (!serveStatic) console.log("[planet] no dist/ found - run `npm run build` for production serving");
});
