// Haven game server: two named identities (renameable), a shared
// passphrase, and persistence - last position, character assignment and chat
// history live in SQLite so the world survives restarts and you resume where
// you left off. It relays state between the two players and never simulates.
// Runs directly with Node >= 23 (type stripping): `node server/index.ts`.
//
// Env: PORT (default 3001), PLANET_PASS (the shared passphrase - set a real
// secret in production, e.g. `fly secrets set PLANET_PASS=...`), DB_PATH.
import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sirv from "sirv";
import { WebSocketServer, type WebSocket } from "ws";
import {
  BOX_LABEL_MAX_LEN,
  CHAT_MAX_LEN,
  MEDIA_MAX_BYTES,
  N,
  NAME_MAX_LEN,
  PASS_MIN_LEN,
  RECALL_WINDOW_MS,
  SETUP_CREATOR,
  TREASURE_HOUSE_TILES,
  boxTileCount,
  mediaOf,
} from "../shared/protocol.ts";
import type {
  Box,
  BoxDenyReason,
  BoxOp,
  BoxSize,
  ClientMessage,
  MediaRef,
  PlayerId,
  ServerMessage,
  StateData,
  Vec3,
} from "../shared/protocol.ts";
import { homeSpot } from "../src/home.ts";
import { Access } from "./access.ts";
import { parseContents } from "./contents.ts";
import { Radio } from "./radio.ts";
import { Spotify } from "./spotify.ts";
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
const spotify =
  process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET
    ? new Spotify(
        process.env.SPOTIFY_CLIENT_ID,
        process.env.SPOTIFY_CLIENT_SECRET,
        process.env.SPOTIFY_REDIRECT_URI ?? "http://127.0.0.1:5173/spotify/callback",
        fetch,
      )
    : null;
const radio = new Radio(store, spotify, (player, msg) => sendTo(player, msg));
// The treasure houses joined the planet after boxes were already standing on
// it: one on a house's tiles would render inside it or block its door. Before
// any connection, lift those into their holders' pockets (a no-op once done).
for (const id of store.liftBoxesOff("globe", TREASURE_HOUSE_TILES)) {
  console.log(`[planet] moved treasure box #${id} off the new treasure house tiles`);
}
const access = new Access((id) => store.ownerOf(id), Date.now);

const distDir = fileURLToPath(new URL("../dist", import.meta.url));
const serveStatic = existsSync(distDir) ? sirv(distDir, { single: true }) : null;

// the build writes its id next to the bundle (vite.config.ts); a tab running
// another bundle reloads when it sees a different id in the welcome
const BUILD_ID = existsSync(join(distDir, "build-id")) ? readFileSync(join(distDir, "build-id"), "utf8").trim() || "dev" : "dev";

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

/** Whether the media file is there; any stat error (a name too long, no permission) counts as not there. */
const fileExists = (name: string) => {
  try {
    return statSync(join(MEDIA_DIR, name), { throwIfNoEntry: false })?.isFile() === true;
  } catch {
    return false;
  }
};

function serveMedia(req: IncomingMessage, res: ServerResponse) {
  const name = (req.url ?? "").slice("/media/".length);
  const file = join(MEDIA_DIR, name);
  // "." and ".." pass the pattern but name directories; only regular files are served
  if (!/^[\w.-]+$/.test(name) || !fileExists(name)) {
    res.statusCode = 404;
    res.end("not found");
    return;
  }
  res.setHeader("content-type", EXT_TO_MIME[name.split(".").pop() ?? ""] ?? "application/octet-stream");
  res.setHeader("cache-control", "public, max-age=31536000, immutable");
  const stream = createReadStream(file);
  stream.on("error", () => {
    res.statusCode = 500;
    res.end();
  });
  stream.pipe(res);
}

const server = createServer((req, res) => {
  if (req.url?.startsWith("/spotify/callback") && req.method === "GET") {
    const url = new URL(req.url, "http://localhost");
    void radio.callback(url.searchParams.get("code") ?? "", url.searchParams.get("state") ?? "").then((ok) => {
      res.statusCode = 302;
      res.setHeader("location", ok ? "/?music=connected" : "/?music=failed");
      res.end();
    });
    return;
  }
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
    res.end("Haven game server is running. In dev, open the Vite URL instead.");
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

/** Denies one box request, naming which op it answers so the client can match it up. */
function deny(ws: WebSocket, op: BoxOp, reason: BoxDenyReason, id?: number) {
  send(ws, id === undefined ? { t: "box-deny", op, reason } : { t: "box-deny", op, id, reason });
}

// ---- treasure boxes ---------------------------------------------------------

/** What `viewer` may see of a box: contents only for the creator, or once opened. */
function viewOf(box: FullBox, viewer: PlayerId): Box {
  if (box.creator === viewer || box.opened !== null) return box;
  const { contents: _hidden, ...sealed } = box;
  return sealed;
}

/** Delete an uploaded file by its /media/<name> url; anything odd or already gone is ignored. */
function removeMediaFile(url: string) {
  const name = url.split("/").pop() ?? "";
  if (!/^[\w.-]+$/.test(name) || name === "." || name === "..") return;
  try {
    unlinkSync(join(MEDIA_DIR, name));
  } catch {
    /* already gone */
  }
}

function broadcastBox(box: FullBox) {
  for (const [pid, c] of conns) send(c.ws, { t: "box", box: viewOf(box, pid) });
}

const isVec3 = (v: unknown): v is Vec3 =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));

const isSize = (s: unknown): s is BoxSize => s === "s" || s === "m" || s === "l";

/** Style, words, picture or prints of a box request, cleaned; null when they make no valid box. */
const contentsOf = (raw: unknown) => parseContents(raw, fileExists);

const GLOBE_TILES = 6 * N * N;

/** Building ids ("globe", "b0".."b7", "opera", "ger", ...): short, lowercase, safe to store. */
const validLoc = (loc: unknown): loc is string => typeof loc === "string" && /^[a-z0-9_-]{1,32}$/.test(loc);

/** Footprint SHAPE (plus the globe's tile range); terrain is the clients' job (both share the seeded world). */
function validFootprint(size: BoxSize, loc: string, tiles: unknown): tiles is number[] {
  if (!Array.isArray(tiles) || tiles.length !== boxTileCount(size)) return false;
  const max = loc === "globe" ? GLOBE_TILES : Infinity;
  if (!tiles.every((t) => Number.isInteger(t) && t >= 0 && t < max)) return false;
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

const cleanLabel = (raw: unknown) =>
  typeof raw === "string" ? raw.slice(0, BOX_LABEL_MAX_LEN).trim() || null : null;

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
  build: BUILD_ID,
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

  const handle = (msg: ClientMessage) => {
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
      const previous = conns.get(wanted);
      if (previous && !msg.take) {
        send(ws, { t: "deny", reason: "taken" });
        return;
      }
      id = wanted;
      if (previous) {
        if (previous.live) store.saveState(wanted, previous.live);
        send(previous.ws, { t: "elsewhere" });
      }
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
        buildings: store.owners(),
        doors: access.grants(),
        knocks: access.knocksFor(id),
        build: BUILD_ID,
        music: radio.view(id),
      });
      radio.joined(id);
      if (previous) previous.ws.close();
      else sendTo(peerId, { t: "peer-joined", id });
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
      for (const g of access.moved(id, state.loc)) {
        broadcast({ t: "door", id: g.id, guest: g.guest, open: false });
      }
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
      if (m.media) removeMediaFile(m.media.url);
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
      const contents = contentsOf(msg.contents);
      const loc = msg.loc;
      if (
        !contents ||
        !isSize(msg.size) ||
        !validLoc(loc) ||
        !validFootprint(msg.size, loc, msg.tiles) ||
        !isVec3(msg.fwd)
      ) {
        deny(ws, "place", "invalid");
        return;
      }
      const denial = placementDenial(id, loc, msg.tiles);
      if (denial) {
        deny(ws, "place", denial);
        return;
      }
      const box = store.addBox({ creator: id, size: msg.size, contents, announce: !!msg.announce, loc, tiles: msg.tiles, fwd: msg.fwd });
      broadcastBox(box);
      console.log(`[planet] ${store.names()[id]} left a ${box.size.toUpperCase()} treasure box #${box.id} in ${loc}`);
    } else if (msg.t === "box-open") {
      const boxId = Number(msg.id);
      const box = store.getBox(boxId);
      if (!box) {
        deny(ws, "open", "missing", boxId);
        return;
      }
      // a box in its creator's pocket is out of sight: nobody else opens it there
      if (box.creator !== id && box.loc === null && box.owner !== id) {
        deny(ws, "open", "missing", boxId);
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
      const boxId = Number(msg.id);
      const box = store.getBox(boxId);
      if (!box) {
        deny(ws, "keep", "missing", boxId);
        return;
      }
      if (box.creator === id) {
        deny(ws, "keep", "creator", boxId);
        return;
      }
      if (box.loc === null) {
        deny(ws, "keep", "missing", boxId); // not standing anywhere
        return;
      }
      store.keepBox(box.id, id, cleanLabel(msg.label) ?? box.label);
      broadcastBox(store.getBox(box.id)!);
      console.log(`[planet] ${store.names()[id]} kept treasure box #${box.id}`);
    } else if (msg.t === "box-home") {
      const boxId = Number(msg.id);
      const box = store.getBox(boxId);
      if (!box) {
        deny(ws, "home", "missing", boxId);
        return;
      }
      if (box.creator === id) {
        deny(ws, "home", "creator", boxId);
        return;
      }
      const inPocket = box.loc === null && box.owner === id;
      if (!inPocket && box.loc === null) {
        deny(ws, "home", "missing", boxId);
        return;
      }
      const loc = id === 0 ? "hive" : "hall";
      const taken = new Set(store.boxesIn(loc).flatMap((b) => b.tiles));
      const spot = homeSpot(box.size, taken);
      if (!spot) {
        deny(ws, "home", "full", boxId);
        return;
      }
      if (!inPocket) store.keepBox(box.id, id, cleanLabel(msg.label) ?? box.label);
      store.putBox(box.id, loc, spot.tiles, spot.fwd);
      broadcastBox(store.getBox(box.id)!);
      console.log(`[planet] ${store.names()[id]} put treasure box #${box.id} in ${loc}`);
    } else if (msg.t === "box-label") {
      const boxId = Number(msg.id);
      const box = store.getBox(boxId);
      if (!box) {
        deny(ws, "label", "missing", boxId);
        return;
      }
      if (box.owner !== id) {
        deny(ws, "label", "owner", boxId);
        return;
      }
      store.labelBox(box.id, cleanLabel(msg.label));
      broadcastBox(store.getBox(box.id)!);
    } else if (msg.t === "box-put") {
      const boxId = Number(msg.id);
      const box = store.getBox(boxId);
      if (!box) {
        deny(ws, "put", "missing", boxId);
        return;
      }
      // the owner puts a kept box down; the creator puts their own unkept box down after lifting it
      if (box.owner !== id && !(box.owner === null && box.creator === id)) {
        deny(ws, "put", "owner", boxId);
        return;
      }
      const loc = msg.loc;
      if (box.loc !== null || !validLoc(loc) || !validFootprint(box.size, loc, msg.tiles) || !isVec3(msg.fwd)) {
        deny(ws, "put", "invalid", boxId);
        return;
      }
      const denial = placementDenial(id, loc, msg.tiles);
      if (denial) {
        deny(ws, "put", denial, boxId);
        return;
      }
      store.putBox(box.id, loc, msg.tiles, msg.fwd);
      broadcastBox(store.getBox(box.id)!);
      console.log(`[planet] ${store.names()[id]} placed treasure box #${box.id} in ${loc}`);
    } else if (msg.t === "box-delete") {
      // taking back your own box, only while nobody has opened it
      const boxId = Number(msg.id);
      const box = store.getBox(boxId);
      if (!box) {
        deny(ws, "delete", "missing", boxId);
        return;
      }
      if (box.creator !== id) {
        deny(ws, "delete", "notcreator", boxId);
        return;
      }
      if (box.opened !== null) {
        deny(ws, "delete", "opened", boxId);
        return;
      }
      store.deleteBox(box.id);
      for (const m of mediaOf(box.contents)) removeMediaFile(m.url);
      broadcast({ t: "box-gone", id: box.id });
      console.log(`[planet] ${store.names()[id]} took back treasure box #${box.id}`);
    } else if (msg.t === "box-edit") {
      // changing what a box you left holds, only while it is still sealed
      const boxId = Number(msg.id);
      const box = store.getBox(boxId);
      if (!box) {
        deny(ws, "edit", "missing", boxId);
        return;
      }
      if (box.creator !== id) {
        deny(ws, "edit", "notcreator", boxId);
        return;
      }
      if (box.owner !== null) {
        deny(ws, "edit", "kept", boxId);
        return;
      }
      if (box.opened !== null) {
        deny(ws, "edit", "opened", boxId);
        return;
      }
      const contents = contentsOf(msg.contents);
      if (!contents) {
        deny(ws, "edit", "invalid", boxId);
        return;
      }
      store.editBox(box.id, contents, !!msg.announce);
      // files the new version no longer uses are gone for good (a replaced picture included)
      const stillUsed = new Set(mediaOf(contents).map((m) => m.url));
      for (const m of mediaOf(box.contents)) if (!stillUsed.has(m.url)) removeMediaFile(m.url);
      broadcastBox(store.getBox(box.id)!);
      console.log(`[planet] ${store.names()[id]} changed treasure box #${box.id}`);
    } else if (msg.t === "box-lift") {
      // picking your own box up to move it, until your partner keeps it
      const boxId = Number(msg.id);
      const box = store.getBox(boxId);
      if (!box) {
        deny(ws, "lift", "missing", boxId);
        return;
      }
      if (box.creator !== id) {
        deny(ws, "lift", "notcreator", boxId);
        return;
      }
      if (box.owner !== null) {
        deny(ws, "lift", "kept", boxId);
        return;
      }
      if (box.loc === null) {
        deny(ws, "lift", "missing", boxId); // already in the pocket
        return;
      }
      store.liftBox(box.id);
      broadcastBox(store.getBox(box.id)!);
      console.log(`[planet] ${store.names()[id]} picked treasure box #${box.id} up`);
    } else if (msg.t === "building-claim") {
      const reason = access.claim(id, msg.id, msg.owner);
      if (reason) {
        send(ws, { t: "building-deny", op: "claim", id: msg.id, reason });
        return;
      }
      store.setOwner(msg.id, msg.owner);
      broadcast({ t: "building", id: msg.id, owner: msg.owner });
      for (const g of access.lastEnded()) {
        broadcast({ t: "door", id: g.id, guest: g.guest, open: false });
      }
      console.log(`[planet] ${store.names()[id]} ${msg.owner === null ? "opened" : "claimed"} ${msg.id}`);
    } else if (msg.t === "knock") {
      const owner = store.ownerOf(msg.id);
      const reason = access.knock(id, msg.id, owner !== null && conns.has(owner));
      if (reason) {
        send(ws, { t: "building-deny", op: "knock", id: msg.id, reason });
        return;
      }
      sendTo(owner as PlayerId, { t: "knock", id: msg.id, from: id });
      console.log(`[planet] ${store.names()[id]} knocked at ${msg.id}`);
    } else if (msg.t === "door-open") {
      const result = access.open(id, msg.id);
      if (typeof result === "string") {
        send(ws, { t: "building-deny", op: "open", id: msg.id, reason: result });
        return;
      }
      broadcast({ t: "door", id: msg.id, guest: result.guest, open: true });
      console.log(`[planet] ${store.names()[id]} let ${store.names()[result.guest]} into ${msg.id}`);
    } else if (msg.t === "music-hear") {
      radio.hear(id);
    } else if (msg.t === "music-play" || msg.t === "music-pause" || msg.t === "music-next") {
      radio.command(id, msg.t === "music-play" ? "play" : msg.t === "music-pause" ? "pause" : "next");
    } else if (msg.t === "music-seek") {
      radio.seek(id, Number(msg.positionMs) || 0);
    } else if (msg.t === "music-add") {
      radio.add(id, msg.track);
    } else if (msg.t === "music-now") {
      radio.now(id, msg.track);
    } else if (msg.t === "music-device") {
      radio.setDevice(id, msg.deviceId, msg.haven === true);
    } else if (msg.t === "music-report") {
      void radio.report(id, msg);
    } else if (msg.t === "music-connect") {
      const url = radio.connectUrl(id);
      if (url) send(ws, { t: "music-auth", url });
      else send(ws, { t: "music-deny", reason: "spotify" });
    } else if (msg.t === "music-token") {
      void radio.token(id).then((access) => {
        if (access) send(ws, { t: "music-token", access });
      });
    } else if (msg.t === "music-search") {
      void radio.search(id, String(msg.q ?? ""));
    } else if (msg.t === "music-playlists") {
      void radio.playlists(id);
    } else if (msg.t === "music-playlist") {
      void radio.playlist(id, String(msg.id ?? ""));
    } else if (msg.t === "music-liked") {
      void radio.liked(id);
    } else if (msg.t === "music-devices") {
      void radio.devices(id);
    }
  };

  ws.on("message", (data) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    // each op denies what it refuses; this is the last resort, so no single frame takes the server down
    try {
      handle(msg);
    } catch (err) {
      console.log(`[planet] bad message from ${id ?? "unjoined"}: ${err instanceof Error ? err.message : String(err)}`);
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
    radio.disconnected(id);
    sendTo((1 - id) as PlayerId, { t: "peer-left", id });
    for (const g of access.left(id)) {
      broadcast({ t: "door", id: g.id, guest: g.guest, open: false });
    }
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
  for (const g of access.expire()) {
    broadcast({ t: "door", id: g.id, guest: g.guest, open: false });
  }
}, 30_000);

server.listen(PORT, () => {
  console.log(`[planet] listening on http://localhost:${PORT} (ws path /ws, db ${DB_PATH})`);
  if (setupMode()) console.log("[planet] no secret word yet - the first visit sets it up in-game");
  if (!serveStatic) console.log("[planet] no dist/ found - run `npm run build` for production serving");
});
