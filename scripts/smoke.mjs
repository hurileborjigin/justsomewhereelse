// End-to-end smoke test for the multiplayer server: boots server/index.ts on a
// test port with a temp database, and checks identity join (passphrase, taken
// slots), state relay, chat persistence, rename and swap persistence across a
// reconnect. Usage: npm run smoke
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3111;
const PASS = "smoketest";
const DB = join(tmpdir(), `tinyplanet-smoke-${Date.now()}.db`);

// no PLANET_PASS: the smoke test exercises the in-game "create the secret
// word" setup flow that production uses
const env = { ...process.env, PORT: String(PORT), DB_PATH: DB };
delete env.PLANET_PASS;
const server = spawn("node", [join(root, "server", "index.ts")], {
  env,
  stdio: ["ignore", "pipe", "pipe"],
});

let done = false;
const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  server.kill();
  process.exit(1);
};
server.on("exit", (code) => {
  if (!done) fail(`server exited early with code ${code}`);
});

await new Promise((resolveReady, reject) => {
  const timer = setTimeout(() => reject(new Error("server did not start")), 8000);
  server.stdout.on("data", (d) => {
    if (String(d).includes("listening")) {
      clearTimeout(timer);
      resolveReady();
    }
  });
}).catch((e) => fail(e.message));

function client(name) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const queue = [];
  const waiters = [];
  ws.on("message", (data) => {
    const msg = JSON.parse(String(data));
    const w = waiters.shift();
    if (w) w(msg);
    else queue.push(msg);
  });
  return {
    ws,
    open: new Promise((r) => ws.on("open", r)),
    next(timeoutMs = 3000) {
      if (queue.length) return Promise.resolve(queue.shift());
      return new Promise((r, j) => {
        const t = setTimeout(() => j(new Error(`${name}: timed out waiting for a message`)), timeoutMs);
        waiters.push((m) => {
          clearTimeout(t);
          r(m);
        });
      });
    },
    send(msg) {
      ws.send(JSON.stringify(msg));
    },
  };
}

const expect = (cond, what) => {
  if (!cond) fail(what);
  console.log(`  ok: ${what}`);
};

const state = (z) => ({ t: "state", p: [0, 0.6, z], q: [0, 0, 0, 1], m: 1, loc: "globe", tile: 42 });

try {
  const a = client("A");
  await a.open;
  const lobbyA = await a.next();
  expect(
    lobbyA.t === "lobby" && lobbyA.names[0] === "gloria" && lobbyA.names[1] === "khurlee" && lobbyA.setup === true,
    "fresh world: lobby announces gloria & khurlee and asks for setup",
  );

  a.send({ t: "join", id: 1, pass: PASS, create: true });
  expect((await a.next()).reason === "setup", "khurlee may not create the secret word");
  a.send({ t: "join", id: 0, pass: PASS });
  expect((await a.next()).reason === "setup", "plain join denied until the word exists");
  a.send({ t: "join", id: 0, pass: "ab", create: true });
  expect((await a.next()).reason === "pass", "too-short secret word rejected");
  a.send({ t: "join", id: 0, pass: PASS, create: true });
  const wa = await a.next();
  expect(
    wa.t === "welcome" && wa.id === 0 && wa.state === null && wa.history.length === 0,
    "gloria creates the word and is welcomed to a fresh world",
  );

  const probe = client("P");
  await probe.open;
  const lobbyP = await probe.next();
  expect(lobbyP.setup === false, "setup is over once the word exists");
  probe.send({ t: "join", id: 1, pass: "wrong" });
  expect((await probe.next()).reason === "pass", "wrong passphrase denied");
  probe.send({ t: "join", id: 1, pass: PASS, create: true });
  expect((await probe.next()).reason === "exists", "creating again is refused");
  probe.ws.close();

  const b = client("B");
  await b.open;
  await b.next(); // lobby
  b.send({ t: "join", id: 0, pass: PASS });
  expect((await b.next()).reason === "taken", "second gloria rejected as taken");
  b.send({ t: "join", id: 1, pass: PASS });
  const wb = await b.next();
  expect(wb.t === "welcome" && wb.id === 1 && wb.peer.online === true, "khurlee welcomed, sees gloria online");
  expect((await a.next()).t === "peer-joined", "gloria told khurlee joined");

  a.send(state(19.5));
  const sb = await b.next();
  expect(sb.t === "state" && sb.id === 0 && sb.tile === 42, "state relayed with tile");

  a.send({ t: "chat", text: "meet me at the lake" });
  const ea = await a.next();
  expect(ea.t === "chat" && ea.from === 0 && typeof ea.id === "number", "sender receives the echo with an id");
  const cb = await b.next();
  expect(cb.t === "chat" && cb.from === 0 && cb.text === "meet me at the lake", "chat relayed");

  // media: upload guarded by the secret word, then sent as a chat message
  const bad = await fetch(`http://localhost:${PORT}/media`, {
    method: "POST",
    headers: { "content-type": "image/png", "x-planet-pass": "wrong" },
    body: Buffer.from("not really a png"),
  });
  expect(bad.status === 403, "media upload rejects wrong passphrase");
  const up = await fetch(`http://localhost:${PORT}/media`, {
    method: "POST",
    headers: { "content-type": "image/png", "x-planet-pass": PASS },
    body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]),
  });
  expect(up.ok, "media upload accepted");
  const media = await up.json();
  expect(/^\/media\/[\w.-]+\.png$/.test(media.url) && media.kind === "image", "upload returns a media ref");
  const got = await fetch(`http://localhost:${PORT}${media.url}`);
  expect(got.ok && (await got.arrayBuffer()).byteLength === 8, "uploaded file is served back");
  // raw request: fetch() would normalize the ".." away before it left the client
  const dotdot = await new Promise((r, j) =>
    get({ port: PORT, path: "/media/.." }, (res) => {
      res.resume();
      r(res.statusCode);
    }).on("error", j),
  );
  expect(dotdot === 404, "a directory under /media is a 404, not a crash");
  const after = await fetch(`http://localhost:${PORT}${media.url}`);
  expect(after.ok, "the server keeps answering after a bad media path");
  a.send({ t: "chat", text: "look!", media });
  const me = await a.next();
  const mb = await b.next();
  expect(mb.t === "chat" && mb.media?.url === media.url && mb.media?.kind === "image", "media chat relayed");

  // recall: only the sender, only within the window; recalled media is wiped
  b.send({ t: "recall", id: me.id }); // not khurlee's message - must be ignored
  a.send({ t: "recall", id: me.id });
  const ra = await a.next();
  const rb = await b.next();
  expect(ra.t === "recalled" && ra.id === me.id && rb.t === "recalled", "recall broadcast to both");
  const gone = await fetch(`http://localhost:${PORT}${media.url}`);
  expect(gone.status === 404, "recalled media file deleted from disk");

  b.send({ t: "rename", name: "K 💙" });
  const na = await a.next();
  await b.next();
  expect(na.t === "names" && na.names[1] === "K 💙", "rename broadcast");

  // ---- treasure boxes ------------------------------------------------------
  // gloria leaves a box (with a photo); khurlee sees WHERE it is, not what's inside
  const up2 = await fetch(`http://localhost:${PORT}/media`, {
    method: "POST",
    headers: { "content-type": "image/png", "x-planet-pass": PASS },
    body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9, 9, 9]),
  });
  const media2 = await up2.json();
  a.send({
    t: "box-place",
    size: "s",
    text: "meet me where the lake is bluest",
    media: [media2],
    announce: true,
    loc: "globe",
    tiles: [43],
    fwd: [0, 0, 1],
  });
  const pa = await a.next();
  const pb = await b.next();
  expect(
    pa.t === "box" && pa.box.text === "meet me where the lake is bluest" && pa.box.media.length === 1,
    "creator sees the contents of the box she left",
  );
  expect(
    pb.t === "box" &&
      pb.box.id === pa.box.id &&
      pb.box.text === undefined &&
      pb.box.media === undefined &&
      pb.box.loc === "globe" &&
      pb.box.origin === "globe" &&
      pb.box.opened === null &&
      pb.box.announce === true,
    "partner sees the sealed box but not its contents",
  );
  const boxId = pa.box.id;

  // refusals: on the partner, overlapping, malformed, creator keeping her own
  b.send({ t: "box-place", size: "s", text: "x", media: [], announce: false, loc: "globe", tiles: [42], fwd: [0, 0, 1] });
  const denyPartner = await b.next();
  expect(
    denyPartner.reason === "partner" &&
      denyPartner.t === "box-deny" &&
      denyPartner.op === "place" &&
      denyPartner.id === undefined,
    "can't drop a box on your partner (live tile)",
  );
  b.send({ t: "box-place", size: "m", text: "x", media: [], announce: false, loc: "globe", tiles: [43, 44, 59, 60], fwd: [0, 0, 1] });
  expect((await b.next()).reason === "overlap", "footprints can't overlap");
  b.send({ t: "box-place", size: "l", text: "x", media: [], announce: false, loc: "globe", tiles: [100, 101], fwd: [0, 0, 1] });
  expect((await b.next()).reason === "invalid", "tile count must match the size");
  b.send({ t: "box-place", size: "s", text: "x", media: [], announce: false, loc: "globe", tiles: [6 * 16 * 16], fwd: [0, 0, 1] });
  expect((await b.next()).reason === "invalid", "globe tiles must exist (one past the last is refused)");
  b.send({ t: "box-place", size: "s", text: "x", media: [], announce: false, loc: "Globe!", tiles: [300], fwd: [0, 0, 1] });
  expect((await b.next()).reason === "invalid", "loc must look like a building id");
  b.send({
    t: "box-place",
    size: "s",
    text: "",
    media: [{ url: "/media/1-deadbeef.png", kind: "image" }],
    announce: false,
    loc: "globe",
    tiles: [300],
    fwd: [0, 0, 1],
  });
  expect((await b.next()).reason === "invalid", "media must be a file the upload endpoint stored");
  a.send({ t: "box-keep", id: boxId });
  const denyCreator = await a.next();
  expect(
    denyCreator.reason === "creator" && denyCreator.op === "keep" && denyCreator.id === boxId,
    "you can't keep a box you left",
  );

  // the creator peeking at her own sealed box does not open it
  a.send({ t: "box-open", id: boxId });
  const peek = await a.next();
  expect(peek.t === "box" && peek.box.opened === null && peek.box.text !== undefined, "creator rereads without unsealing");

  // opening reveals the postcard to both and records the moment
  b.send({ t: "box-open", id: boxId });
  const oa = await a.next();
  const ob = await b.next();
  expect(
    ob.t === "box" && ob.box.text === "meet me where the lake is bluest" && typeof ob.box.opened === "number",
    "opening reveals the postcard",
  );
  expect(oa.t === "box" && oa.box.opened === ob.box.opened, "the creator learns it was opened");

  // keeping with a label takes it out of the world
  b.send({ t: "box-keep", id: boxId, label: "the lake one" });
  await a.next();
  const kb = await b.next();
  expect(
    kb.t === "box" &&
      kb.box.owner === 1 &&
      kb.box.loc === null &&
      kb.box.tiles.length === 0 &&
      kb.box.label === "the lake one" &&
      kb.box.origin === "globe",
    "kept: held by khurlee with a label",
  );

  // a held box can't be put down on top of another one
  a.send({ t: "box-place", size: "s", text: "a second one", media: [], announce: false, loc: "globe", tiles: [300], fwd: [0, 0, 1] });
  const second = await a.next();
  await b.next();
  expect(second.t === "box" && second.box.tiles[0] === 300, "gloria leaves a second box");
  b.send({ t: "box-put", id: boxId, loc: "globe", tiles: [300], fwd: [0, 0, 1] });
  const denyPut = await b.next();
  expect(
    denyPut.t === "box-deny" && denyPut.op === "put" && denyPut.id === boxId && denyPut.reason === "overlap",
    "putting a held box onto another box is refused",
  );

  // only the owner labels or places it
  a.send({ t: "box-label", id: boxId, label: "mine" });
  expect((await a.next()).reason === "owner", "only the owner labels a box");
  a.send({ t: "box-put", id: boxId, loc: "globe", tiles: [200], fwd: [0, 0, 1] });
  expect((await a.next()).reason === "owner", "only the owner places a box");
  b.send({ t: "box-label", id: boxId, label: "the lake postcard" });
  await a.next();
  expect((await b.next()).box.label === "the lake postcard", "owner relabels");

  // back into the world, inside the ger this time
  b.send({ t: "box-put", id: boxId, loc: "ger", tiles: [12], fwd: [1, 0, 0] });
  const ta = await a.next();
  const tb = await b.next();
  expect(tb.t === "box" && tb.box.loc === "ger" && tb.box.tiles[0] === 12 && tb.box.owner === 1, "placed back inside the ger");
  expect(ta.t === "box" && ta.box.text !== undefined, "creator still sees her postcard wherever it stands");

  a.ws.close();
  expect((await b.next()).t === "peer-left", "khurlee told gloria left");

  // reconnect: position, chat and rename must all have persisted
  const a2 = client("A2");
  await a2.open;
  await a2.next(); // lobby
  a2.send({ t: "join", id: 0, pass: PASS });
  const w2 = await a2.next();
  expect(
    w2.t === "welcome" &&
      w2.state?.tile === 42 &&
      w2.history.length === 1 &&
      w2.history[0].text === "meet me at the lake" &&
      w2.names[1] === "K 💙" &&
      w2.boxes.length === 2 &&
      w2.boxes.some(
        (x) =>
          x.id === boxId &&
          x.loc === "ger" &&
          x.label === "the lake postcard" &&
          x.text === "meet me where the lake is bluest",
      ),
    "reconnect: history keeps the text message, not the recalled one; the box is where khurlee put it",
  );

  console.log("SMOKE PASSED");
  done = true;
  server.kill();
  rmSync(DB, { force: true });
  process.exit(0);
} catch (e) {
  fail(e.message);
}
