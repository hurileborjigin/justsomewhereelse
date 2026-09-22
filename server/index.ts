// Tiny Planet game server: a two-slot relay. It assigns the bee/donkey,
// forwards state between the two players and tracks presence. It never
// simulates anything. In production it also serves the built client (dist/).
// Runs directly with Node >= 23 (type stripping): `node server/index.ts`.
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import sirv from "sirv";
import { WebSocketServer, type WebSocket } from "ws";
import { CHAT_MAX_LEN } from "../shared/protocol.ts";
import type {
  CharacterId,
  ClientMessage,
  ServerMessage,
  StateData,
} from "../shared/protocol.ts";

const PORT = Number(process.env.PORT ?? 3001);

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

type Slot = { ws: WebSocket; alive: boolean; state: StateData | null };
const slots: (Slot | null)[] = [null, null];
let assign: [CharacterId, CharacterId] = ["bee", "donkey"];

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  const id = slots.findIndex((s) => s === null);
  if (id === -1) {
    send(ws, { t: "full" });
    ws.close();
    return;
  }
  const slot: Slot = { ws, alive: true, state: null };
  slots[id] = slot;
  const peer = slots[1 - id];

  send(ws, {
    t: "welcome",
    id,
    character: assign[id],
    peer: peer
      ? { id: 1 - id, character: assign[1 - id], state: peer.state ?? undefined }
      : undefined,
  });
  if (peer) send(peer.ws, { t: "peer-joined", id, character: assign[id] });
  console.log(`[planet] player ${id} joined as ${assign[id]}`);

  ws.on("message", (data) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.t === "state") {
      const state: StateData = { p: msg.p, q: msg.q, m: msg.m, loc: msg.loc ?? "globe" };
      slot.state = state;
      const other = slots[1 - id];
      if (other) send(other.ws, { t: "state", id, ...state });
    } else if (msg.t === "swap") {
      assign = [assign[1], assign[0]];
      for (const s of slots) if (s) send(s.ws, { t: "characters", assign });
      console.log(`[planet] characters swapped: 0=${assign[0]}, 1=${assign[1]}`);
    } else if (msg.t === "chat") {
      const text = String(msg.text ?? "").slice(0, CHAT_MAX_LEN).trim();
      if (!text) return;
      const other = slots[1 - id];
      if (other) send(other.ws, { t: "chat", id, text });
    }
  });

  ws.on("pong", () => {
    slot.alive = true;
  });

  ws.on("close", () => {
    if (slots[id] !== slot) return;
    slots[id] = null;
    const other = slots[1 - id];
    if (other) send(other.ws, { t: "peer-left", id });
    console.log(`[planet] player ${id} left`);
  });
});

setInterval(() => {
  for (const s of slots) {
    if (!s) continue;
    if (!s.alive) {
      s.ws.terminate();
      continue;
    }
    s.alive = false;
    s.ws.ping();
  }
}, 30_000);

server.listen(PORT, () => {
  console.log(`[planet] listening on http://localhost:${PORT} (ws path /ws)`);
  if (!serveStatic) console.log("[planet] no dist/ found - run `npm run build` for production serving");
});
