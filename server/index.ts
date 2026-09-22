// Tiny Planet game server: two named identities (renameable), a shared
// passphrase, and persistence - last position, character assignment and chat
// history live in SQLite so the world survives restarts and you resume where
// you left off. It relays state between the two players and never simulates.
// Runs directly with Node >= 23 (type stripping): `node server/index.ts`.
//
// Env: PORT (default 3001), PLANET_PASS (the shared passphrase - set a real
// secret in production, e.g. `fly secrets set PLANET_PASS=...`), DB_PATH.
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import sirv from "sirv";
import { WebSocketServer, type WebSocket } from "ws";
import { CHAT_MAX_LEN, NAME_MAX_LEN } from "../shared/protocol.ts";
import type {
  ClientMessage,
  PlayerId,
  ServerMessage,
  StateData,
} from "../shared/protocol.ts";
import { Store } from "./store.ts";

const PORT = Number(process.env.PORT ?? 3001);
const PASS = process.env.PLANET_PASS ?? "planet";
const DB_PATH = process.env.DB_PATH ?? "data/planet.db";

const store = new Store(DB_PATH);

const distDir = fileURLToPath(new URL("../dist", import.meta.url));
const serveStatic = existsSync(distDir) ? sirv(distDir, { single: true }) : null;

const server = createServer((req, res) => {
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

const online = (): [boolean, boolean] => [conns.has(0), conns.has(1)];

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  let id: PlayerId | null = null;

  send(ws, { t: "lobby", names: store.names(), online: online() });

  ws.on("message", (data) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (msg.t === "join") {
      if (id !== null) return;
      if (msg.pass !== PASS) {
        send(ws, { t: "deny", reason: "pass" });
        return;
      }
      const wanted: PlayerId = msg.id === 0 ? 0 : 1;
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
        assign: store.assign(),
        state: store.state(id),
        peer: {
          online: !!peerConn,
          state: peerConn ? (peerConn.live ?? store.state(peerId)) : null,
        },
        history: store.history(200),
      });
      sendTo(peerId, { t: "peer-joined", id });
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
      if (!text) return;
      const entry = store.addMessage(id, text);
      sendTo((1 - id) as PlayerId, { t: "chat", ...entry });
    } else if (msg.t === "swap") {
      const [a, b] = store.assign();
      store.setAssign([b, a]);
      broadcast({ t: "characters", assign: [b, a] });
      console.log(`[planet] characters swapped: 0=${b}, 1=${a}`);
    } else if (msg.t === "rename") {
      const name = String(msg.name ?? "").slice(0, NAME_MAX_LEN).trim();
      if (!name) return;
      store.rename(id, name);
      broadcast({ t: "names", names: store.names() });
      console.log(`[planet] player ${id} renamed to ${name}`);
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
  if (PASS === "planet") console.log("[planet] WARNING: using the default passphrase - set PLANET_PASS in production");
  if (!serveStatic) console.log("[planet] no dist/ found - run `npm run build` for production serving");
});
