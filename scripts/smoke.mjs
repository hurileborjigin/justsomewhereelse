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
    lobbyA.t === "lobby" &&
      lobbyA.names[0] === "gloria" &&
      lobbyA.names[1] === "khurlee" &&
      lobbyA.setup === true &&
      typeof lobbyA.build === "string" &&
      lobbyA.build.length > 0,
    "fresh world: lobby announces gloria & khurlee, asks for setup, and carries a build id",
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
  expect(typeof wa.build === "string" && wa.build.length > 0, "welcome carries the server's build id");

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
    contents: {
      style: "postcard",
      picture: { image: media2, focus: { x: 0.3, y: 0.7 }, zoom: 1.5, caption: "the lake at dusk" },
      writing: { text: "meet me where the lake is bluest", stamp: "🐝", place: "the lake", to: "my love", from: "your bee" },
    },
    announce: true,
    loc: "globe",
    tiles: [43],
    fwd: [0, 0, 1],
  });
  const pa = await a.next();
  const pb = await b.next();
  expect(
    pa.t === "box" &&
      pa.box.contents.style === "postcard" &&
      pa.box.contents.writing.text === "meet me where the lake is bluest" &&
      pa.box.contents.writing.to === "my love" &&
      pa.box.contents.picture.image.url === media2.url &&
      pa.box.contents.picture.focus.x === 0.3 &&
      pa.box.contents.picture.zoom === 1.5 &&
      pa.box.contents.picture.caption === "the lake at dusk",
    "creator sees the postcard she left: words, dressing, picture and its crop",
  );
  expect(
    pb.t === "box" &&
      pb.box.id === pa.box.id &&
      pb.box.contents === undefined &&
      pb.box.style === undefined &&
      pb.box.loc === "globe" &&
      pb.box.origin === "globe" &&
      pb.box.opened === null &&
      pb.box.announce === true,
    "partner sees the sealed box but neither its contents nor its style",
  );
  const boxId = pa.box.id;

  // refusals: on the partner, overlapping, malformed, creator keeping her own
  const flatWords = (text) => ({ style: "postcard", picture: null, writing: { text, stamp: "", place: "", to: "", from: "" } });
  b.send({ t: "box-place", size: "s", contents: flatWords("x"), announce: false, loc: "globe", tiles: [42], fwd: [0, 0, 1] });
  const denyPartner = await b.next();
  expect(
    denyPartner.reason === "partner" &&
      denyPartner.t === "box-deny" &&
      denyPartner.op === "place" &&
      denyPartner.id === undefined,
    "can't drop a box on your partner (live tile)",
  );
  b.send({ t: "box-place", size: "m", contents: flatWords("x"), announce: false, loc: "globe", tiles: [43, 44, 59, 60], fwd: [0, 0, 1] });
  expect((await b.next()).reason === "overlap", "footprints can't overlap");
  b.send({ t: "box-place", size: "l", contents: flatWords("x"), announce: false, loc: "globe", tiles: [100, 101], fwd: [0, 0, 1] });
  expect((await b.next()).reason === "invalid", "tile count must match the size");
  b.send({ t: "box-place", size: "s", contents: flatWords("x"), announce: false, loc: "globe", tiles: [6 * 16 * 16], fwd: [0, 0, 1] });
  expect((await b.next()).reason === "invalid", "globe tiles must exist (one past the last is refused)");
  b.send({ t: "box-place", size: "s", contents: flatWords("x"), announce: false, loc: "Globe!", tiles: [300], fwd: [0, 0, 1] });
  expect((await b.next()).reason === "invalid", "loc must look like a building id");
  // three ways a picture can be rejected, then the old flat shape from before contents existed
  const upVid = await fetch(`http://localhost:${PORT}/media`, {
    method: "POST",
    headers: { "content-type": "video/mp4", "x-planet-pass": PASS },
    body: Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]),
  });
  const clip = await upVid.json();
  const picturePlace = (picture, tiles = [300]) => ({
    t: "box-place",
    size: "s",
    contents: { style: "postcard", picture, writing: { text: "", stamp: "", place: "", to: "", from: "" } },
    announce: false,
    loc: "globe",
    tiles,
    fwd: [0, 0, 1],
  });
  b.send(picturePlace({ image: clip, focus: { x: 0.5, y: 0.5 }, zoom: 1, caption: "" }));
  expect((await b.next()).reason === "invalid", "a video cannot be the picture side");
  b.send(picturePlace({ image: { url: "/media/1-deadbeef.png", kind: "image" }, focus: { x: 0.5, y: 0.5 }, zoom: 1, caption: "" }));
  expect((await b.next()).reason === "invalid", "the picture must be a file the upload endpoint stored");
  b.send(picturePlace(null));
  expect((await b.next()).reason === "invalid", "a postcard needs words or a picture");
  b.send({ t: "box-place", size: "s", style: "postcard", text: "old tab", media: [], announce: false, loc: "globe", tiles: [300], fwd: [0, 0, 1] });
  expect((await b.next()).reason === "invalid", "a message in the old flat shape is refused");
  b.send({ t: "box-place", size: "s", contents: { style: "note", text: "", media: [media2] }, announce: false, loc: "globe", tiles: [301], fwd: [0, 0, 1] });
  expect((await b.next()).reason === "invalid", "a note needs words");
  b.send({ t: "box-place", size: "s", contents: { style: "media", caption: "just words", media: [] }, announce: false, loc: "globe", tiles: [301], fwd: [0, 0, 1] });
  expect((await b.next()).reason === "invalid", "a photo box needs a photo");
  // a picture's focus and zoom are clamped and its caption cut, odd dressing is tamed, notes carry no dressing
  const upClamp = await fetch(`http://localhost:${PORT}/media`, {
    method: "POST",
    headers: { "content-type": "image/png", "x-planet-pass": PASS },
    body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 7, 7, 7, 7]),
  });
  const mediaClamp = await upClamp.json();
  a.send(picturePlace({ image: mediaClamp, focus: { x: 2, y: -1 }, zoom: 9, caption: "🌙".repeat(70) }, [303]));
  const legacy = await a.next();
  await b.next();
  expect(
    legacy.t === "box" &&
      legacy.box.contents.picture.focus.x === 1 &&
      legacy.box.contents.picture.focus.y === 0 &&
      legacy.box.contents.picture.zoom === 3 &&
      [...legacy.box.contents.picture.caption].length === 60,
    "focus and zoom are clamped and the caption is cut at 60",
  );
  a.send({
    t: "box-place",
    size: "s",
    contents: {
      style: "postcard",
      picture: null,
      writing: { text: "odd card", stamp: "🐝🐝🐝", place: "x".repeat(100), to: 42, from: { no: 1 } },
    },
    announce: false,
    loc: "globe",
    tiles: [304],
    fwd: [0, 0, 1],
  });
  const odd = await a.next();
  await b.next();
  expect(
    odd.box.contents.writing.stamp === "🐝🐝" &&
      odd.box.contents.writing.place.length === 40 &&
      odd.box.contents.writing.to === "" &&
      odd.box.contents.writing.from === "",
    "the dressing is cut to its limits and non-strings fall back to the defaults",
  );
  a.send({ t: "box-place", size: "s", contents: { style: "note", text: "a note", media: [] }, announce: false, loc: "globe", tiles: [305], fwd: [0, 0, 1] });
  const noted = await a.next();
  await b.next();
  expect(noted.box.contents.style === "note" && noted.box.contents.writing === undefined, "a note never carries writing");
  a.send({ t: "box-delete", id: 9999 });
  expect((await a.next()).reason === "missing", "taking back a box that does not exist is refused");
  for (const id of [legacy.box.id, odd.box.id, noted.box.id]) {
    a.send({ t: "box-delete", id });
    await a.next();
    await b.next();
  }
  a.send({ t: "box-keep", id: boxId });
  const denyCreator = await a.next();
  expect(
    denyCreator.reason === "creator" && denyCreator.op === "keep" && denyCreator.id === boxId,
    "you can't keep a box you left",
  );

  // the creator peeking at her own sealed box does not open it
  a.send({ t: "box-open", id: boxId });
  const peek = await a.next();
  expect(peek.t === "box" && peek.box.opened === null && peek.box.contents !== undefined, "creator rereads without unsealing");

  // the creator changes her mind while the box is still sealed
  const up4 = await fetch(`http://localhost:${PORT}/media`, {
    method: "POST",
    headers: { "content-type": "image/png", "x-planet-pass": PASS },
    body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 4, 4, 4, 4]),
  });
  const media4 = await up4.json();
  a.send({
    t: "box-edit",
    id: boxId,
    contents: {
      style: "postcard",
      picture: { image: media4, focus: { x: 0.5, y: 0.5 }, zoom: 1, caption: "dusk, later" },
      writing: { text: "meet me where the lake is bluest, at dusk", stamp: "🐝", place: "the lake", to: "sweetheart", from: "your bee" },
    },
    announce: false,
  });
  const editedA = await a.next();
  const editedB = await b.next();
  expect(
    editedA.t === "box" &&
      editedA.box.contents.writing.text === "meet me where the lake is bluest, at dusk" &&
      editedA.box.contents.writing.to === "sweetheart" &&
      editedA.box.contents.picture.image.url === media4.url &&
      editedA.box.contents.picture.caption === "dusk, later" &&
      editedA.box.announce === false,
    "the creator edits words, dressing, photo and announcement",
  );
  expect(editedB.t === "box" && editedB.box.contents === undefined && editedB.box.announce === false, "the partner still sees a sealed box");
  expect((await fetch(`http://localhost:${PORT}${media2.url}`)).status === 404, "the picture the edit replaced is deleted from disk");
  b.send({ t: "box-edit", id: boxId, contents: { style: "note", text: "mine now", media: [] }, announce: true });
  expect((await b.next()).reason === "notcreator", "only the creator edits a box");

  // she picks it up and puts it down again; her partner cannot
  b.send({ t: "box-lift", id: boxId });
  expect((await b.next()).reason === "notcreator", "only the creator picks her own box up");
  a.send({ t: "box-lift", id: boxId });
  const la = await a.next();
  await b.next();
  expect(la.t === "box" && la.box.loc === null && la.box.tiles.length === 0 && la.box.owner === null, "lifted: in the creator's pocket, still nobody's");
  b.send({ t: "box-open", id: boxId });
  expect((await b.next()).reason === "missing", "a box in the creator's pocket cannot be opened by the partner");
  b.send({ t: "box-put", id: boxId, loc: "globe", tiles: [43], fwd: [0, 0, 1] });
  expect((await b.next()).reason === "owner", "the partner cannot put the creator's lifted box down");
  a.send({ t: "box-put", id: boxId, loc: "globe", tiles: [43], fwd: [0, 0, 1] });
  const put2 = await a.next();
  await b.next();
  expect(put2.t === "box" && put2.box.loc === "globe" && put2.box.tiles[0] === 43, "the creator puts her unkept box down again");
  a.send({ t: "box-put", id: boxId, loc: "globe", tiles: [44], fwd: [0, 0, 1] });
  expect((await a.next()).reason === "invalid", "a standing box is not put down again without lifting it first");
  // a second edit keeps the same photo with a new caption; the kept file must survive
  a.send({
    t: "box-edit",
    id: boxId,
    contents: {
      style: "postcard",
      picture: { image: media4, focus: { x: 0.5, y: 0.5 }, zoom: 1, caption: "still dusk" },
      writing: { text: "meet me where the lake is bluest, at dusk", stamp: "🐝", place: "the lake", to: "sweetheart", from: "your bee" },
    },
    announce: false,
  });
  const again = await a.next();
  await b.next();
  expect(
    again.box.contents.picture.caption === "still dusk" && (await fetch(`http://localhost:${PORT}${media4.url}`)).status === 200,
    "a picture kept through an edit stays on disk",
  );

  // opening reveals the postcard to both and records the moment
  b.send({ t: "box-open", id: boxId });
  const oa = await a.next();
  const ob = await b.next();
  expect(
    ob.t === "box" &&
      ob.box.contents.writing.text === "meet me where the lake is bluest, at dusk" &&
      ob.box.contents.writing.stamp === "🐝" &&
      ob.box.contents.picture.caption === "still dusk" &&
      typeof ob.box.opened === "number",
    "opening reveals the postcard, its dressing and its picture",
  );
  expect(oa.t === "box" && oa.box.opened === ob.box.opened, "the creator learns it was opened");
  a.send({
    t: "box-edit",
    id: boxId,
    contents: { style: "postcard", picture: null, writing: { text: "too late", stamp: "", place: "", to: "", from: "" } },
    announce: true,
  });
  expect((await a.next()).reason === "opened", "an opened box cannot be edited");
  a.send({ t: "box-lift", id: boxId });
  const liftedOpen = await a.next();
  await b.next();
  expect(
    liftedOpen.t === "box" && liftedOpen.box.loc === null && liftedOpen.box.opened !== null,
    "an opened box that nobody kept can still be picked up",
  );
  a.send({ t: "box-put", id: boxId, loc: "globe", tiles: [43], fwd: [0, 0, 1] });
  await a.next();
  await b.next();

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
  a.send({ t: "box-lift", id: boxId });
  expect((await a.next()).reason === "kept", "a kept box cannot be picked up by its creator");
  a.send({
    t: "box-edit",
    id: boxId,
    contents: { style: "postcard", picture: null, writing: { text: "too late", stamp: "", place: "", to: "", from: "" } },
    announce: true,
  });
  expect((await a.next()).reason === "kept", "a kept box cannot be edited");

  // a held box can't be put down on top of another one
  a.send({ t: "box-place", size: "s", contents: flatWords("a second one"), announce: false, loc: "globe", tiles: [300], fwd: [0, 0, 1] });
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
  expect(ta.t === "box" && ta.box.contents !== undefined, "creator still sees her postcard wherever it stands");

  // ---- taking back a sealed box ---------------------------------------------
  const up3 = await fetch(`http://localhost:${PORT}/media`, {
    method: "POST",
    headers: { "content-type": "image/png", "x-planet-pass": PASS },
    body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 3, 3, 3, 3]),
  });
  const media3 = await up3.json();
  a.send({ t: "box-place", size: "s", contents: { style: "note", text: "on second thought", media: [media3] }, announce: false, loc: "globe", tiles: [302], fwd: [0, 0, 1] });
  const third = await a.next();
  await b.next();
  expect(third.t === "box" && third.box.contents.style === "note" && third.box.contents.media.length === 1, "a note carries no postcard dressing");
  b.send({ t: "box-delete", id: third.box.id });
  const denyTake = await b.next();
  expect(
    denyTake.t === "box-deny" && denyTake.op === "delete" && denyTake.id === third.box.id && denyTake.reason === "notcreator",
    "only the one who left a box can take it back",
  );
  a.send({ t: "box-delete", id: boxId });
  expect((await a.next()).reason === "opened", "an opened box cannot be taken back");
  a.send({ t: "box-delete", id: third.box.id });
  const ga = await a.next();
  const gb = await b.next();
  expect(
    ga.t === "box-gone" && ga.id === third.box.id && gb.t === "box-gone" && gb.id === third.box.id,
    "taking back a sealed box tells both players it is gone",
  );
  expect((await fetch(`http://localhost:${PORT}${media3.url}`)).status === 404, "the taken-back box's photo is deleted from disk");

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
          x.contents.writing.text === "meet me where the lake is bluest, at dusk",
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
