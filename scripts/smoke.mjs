// End-to-end smoke test for the multiplayer server: boots server/index.ts on a
// test port, connects two fake players plus a rejected third, and checks the
// whole message flow (welcome, state relay, swap, peer-left).
// Usage: npm run smoke
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3111;

const server = spawn("node", [join(root, "server", "index.ts")], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});

const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  server.kill();
  process.exit(1);
};

server.on("exit", (code) => {
  if (!done) fail(`server exited early with code ${code}`);
});
let done = false;

await new Promise((resolveReady, reject) => {
  const timer = setTimeout(() => reject(new Error("server did not start")), 8000);
  server.stdout.on("data", (d) => {
    if (String(d).includes("listening")) {
      clearTimeout(timer);
      resolveReady();
    }
  });
  server.stderr.on("data", (d) => process.stderr.write(d));
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
    name,
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

try {
  const a = client("A");
  await a.open;
  a.send({ t: "hello" });
  const wa = await a.next();
  expect(wa.t === "welcome" && wa.id === 0 && wa.character === "bee" && !wa.peer, "A welcomed as bee, alone");

  const b = client("B");
  await b.open;
  b.send({ t: "hello" });
  const wb = await b.next();
  expect(
    wb.t === "welcome" && wb.id === 1 && wb.character === "donkey" && wb.peer?.id === 0 && wb.peer?.character === "bee",
    "B welcomed as donkey and sees A",
  );
  const ja = await a.next();
  expect(ja.t === "peer-joined" && ja.id === 1 && ja.character === "donkey", "A told that B joined");

  a.send({ t: "state", p: [1.5, 2.5, 19.5], q: [0, 0, 0, 1], m: 1 });
  const sb = await b.next();
  expect(sb.t === "state" && sb.id === 0 && sb.p[0] === 1.5 && sb.m === 1, "state relayed A -> B");

  b.send({ t: "swap" });
  const ca = await a.next();
  const cb = await b.next();
  expect(
    ca.t === "characters" && ca.assign[0] === "donkey" && ca.assign[1] === "bee" && cb.t === "characters",
    "swap broadcast to both",
  );

  const c = client("C");
  await c.open;
  const fc = await c.next();
  expect(fc.t === "full", "third player rejected as full");

  a.ws.close();
  const la = await b.next();
  expect(la.t === "peer-left" && la.id === 0, "B told that A left");

  // reconnect takes the freed slot with the swapped character
  const d = client("D");
  await d.open;
  const wd = await d.next();
  expect(wd.t === "welcome" && wd.id === 0 && wd.character === "donkey", "rejoiner gets slot 0 (now donkey)");

  console.log("SMOKE PASSED");
  done = true;
  server.kill();
  process.exit(0);
} catch (e) {
  fail(e.message);
}
