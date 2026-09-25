// Visual check for the treasure houses and two-step placement.
// On the globe gloria (A) aims a new box's shade at a tree (red) and at open
// grass (green) and puts an M box down on exactly the green tiles; khurlee (B)
// keeps it with a label, sets it down on the globe (its label floats over it,
// none floats over an unlabelled box) and picks it up again. In the Hive A aims
// an L box over the S spine (red), puts it into an L bay, and an S box onto an
// S shelf. In the Copper Hall B puts one box of each size into a matching bay:
// the labelled M into an M bay, a new S onto an S shelf, a new L into an L bay.
// Every box on a bay stands on the plinth. Then the Copper Hall fills with
// labelled boxes (set up with raw requests: A leaves each one straight into a
// bay, B opens the L ones, keeps each with a label and puts it back): zoomed
// all the way out at the door, a tag on a bay far down the hall still shows,
// and an opened L chest keeps its tag at the chest, not up on its lid. Then a
// tour of both halls and both exteriors, and an opened, labelled L box on the
// globe.
// Claiming, the sign, knocking, letting in, entering, being kept out before and
// after a visit, the pennants and the camera fade are covered by
// scripts/drive-doors.mjs; the placing bar's edges (disabled sizes, cancel,
// refusals, one upload) by scripts/drive-treasure.mjs.
// Screenshots land in /tmp/haven-houses-<desktop|phone>-*.png.
// Run against a FRESH database so the world starts without boxes:
//   rm -f /tmp/tp-houses.db; DB_PATH=/tmp/tp-houses.db PLANET_PASS=planet npm run dev
//   node scripts/drive-houses.mjs
// MOBILE=1 drives a 390x844 touch phone instead of a 1280x800 desktop.
import { chromium } from "playwright-core";
import { headlessShell } from "./_browser.mjs";

const URL = process.argv[2] ?? "http://localhost:5173";
const MOBILE = process.env.MOBILE === "1";
const tag = MOBILE ? "phone" : "desktop";
const shot = (page, name) => page.screenshot({ path: `/tmp/haven-houses-${tag}-${name}.png` });
const check = (cond, what) => {
  if (!cond) {
    console.error(`FAIL: ${what}`);
    process.exitCode = 1;
  } else console.log(`  ok: ${what}`);
};

const browser = await chromium.launch({ executablePath: headlessShell(), args: ["--no-sandbox"] });

async function openPlayer(name) {
  const ctx = await browser.newContext(
    MOBILE
      ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }
      : { viewport: { width: 1280, height: 800 } },
  );
  await ctx.addInitScript(
    (id) => localStorage.setItem("tp-auth", JSON.stringify({ id, pass: "planet" })),
    name === "A" ? 0 : 1,
  );
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`[${name}] pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`[${name}] console.error: ${m.text()}`);
  });
  await page.goto(URL);
  await page.waitForFunction(() => window.__tp?.joined(), { timeout: 20000 });
  return page;
}

const a = await openPlayer("A");
const b = await openPlayer("B");
await a.waitForTimeout(1200);
check(
  (await a.evaluate(() => window.__tp.treasures.list().length)) === 0,
  "fresh database: no boxes yet (delete /tmp/tp-houses.db and restart the dev server if this fails)",
);
if (process.exitCode) {
  await browser.close();
  process.exit(1);
}

const W = 20; // the gallery's width in tiles (src/gallery.ts)
const PLINTH_H = 0.5;
const key = (i, j) => j * W + i;
const SPAWN_A = 646;
const SPAWN_B = 649;

const tapOrClick = (p, sel) => (MOBILE ? p.tap(sel) : p.click(sel));
const pl = (p) => p.evaluate(() => window.__tp.placing());
const boxById = (p, id) => p.evaluate((i) => window.__tp.treasures.list().find((x) => x.id === i), id);
const waitBox = (p, id, field, value) =>
  p.waitForFunction(([i, f, v]) => window.__tp.treasures.list().find((x) => x.id === i)?.[f] === v, [id, field, value], {
    timeout: 10000,
  });
const mounted = (p, id) => p.evaluate((i) => window.__tp.treasures.mounted().find((m) => m.id === i), id);
const sameTiles = (x, y) => x.length === y.length && [...x].sort((m, n) => m - n).every((v, n) => v === [...y].sort((m, n) => m - n)[n]);
/** The visible floating labels as `p` sees them: text and where they sit on screen. */
const labels = (p) =>
  p.evaluate(() =>
    [...document.querySelectorAll("#box-labels .box-label")]
      .filter((e) => getComputedStyle(e).opacity !== "0" && getComputedStyle(document.getElementById("box-labels")).display !== "none")
      .map((e) => {
        const r = e.getBoundingClientRect();
        return { text: e.textContent, x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
      }),
  );
const onScreen = (l, vw, vh) => l.x > 0 && l.x < vw && l.y > 0 && l.y < vh && l.w > 10 && l.h > 8;
const viewport = MOBILE ? [390, 844] : [1280, 800];

/** Opens a new postcard with `text` and sends it: placing mode begins. */
async function compose(p, text) {
  await p.click("#treasure-open");
  await p.click("#treasure-leave");
  await p.waitForSelector("#postcard textarea.pc-text");
  await p.fill("#postcard textarea.pc-text", text);
  await tapOrClick(p, "#pc-send");
  await p.waitForFunction(() => window.__tp.placing().active, null, { timeout: 5000 });
}
/** In a hall: stand `p` on tile (i, j) facing along (di, dj) and wait for the shade to follow. */
async function aimInHall(p, i, j, di, dj) {
  await p.evaluate(
    ([k, x, z]) => {
      const pl = window.__tp.player;
      pl.enterWorld(pl.world, k, pl.forward.clone().set(x, 0, z));
    },
    [key(i, j), di, dj],
  );
  await p.waitForFunction(
    (k) => {
      const s = window.__tp.placing();
      return s.tiles.length > 0 && window.__tp.player.tile === k && s.ok.length === s.tiles.length;
    },
    key(i, j),
    { timeout: 5000 },
  );
  await p.waitForTimeout(900); // the colours follow at once; the camera swings round behind her more slowly
  return pl(p);
}
/** Puts the box down on the current all-green shade and returns the placed box. */
async function confirm(p) {
  await p.waitForFunction(() => !document.getElementById("pl-put").disabled, null, { timeout: 5000 });
  await (MOBILE ? p.tap("#pl-put") : p.keyboard.press("e"));
  await p.waitForFunction(() => !window.__tp.placing().active, null, { timeout: 20000 });
}
/**
 * On the globe: tries stand tiles near `center` (walkable, off the spawns) and each of their
 * neighbors as a facing until the shade is all green; returns the shade, or null.
 */
async function aimGreenOnGlobe(p, center, avoid = []) {
  const stands = await p.evaluate(
    ([c, av]) => {
      const tp = window.__tp;
      const seen = new Set([c]);
      let ring = [c];
      const out = [];
      for (let d = 0; d < 5; d++) {
        const next = [];
        for (const k of ring)
          for (const n of tp.neighbors(k)) {
            if (seen.has(n)) continue;
            seen.add(n);
            next.push(n);
            if (tp.walkable(n) && !av.includes(n)) out.push(n);
          }
        ring = next;
      }
      return out;
    },
    [center, [SPAWN_A, SPAWN_B, ...avoid]],
  );
  for (const s of stands) {
    const facings = await p.evaluate((k) => window.__tp.neighbors(k), s);
    for (const f of facings) {
      await p.evaluate(
        ([k, t]) => {
          window.__tp.teleport(k);
          window.__tp.lookAt(t);
        },
        [s, f],
      );
      await p.waitForTimeout(60);
      const st = await pl(p);
      if (st.tiles.length > 0 && st.ok.length === st.tiles.length && st.ok.every(Boolean) && !st.tiles.some((t) => avoid.includes(t))) return st;
    }
  }
  return null;
}

// ---- the globe: the shade over a tree and over grass ---------------------
// a tree next to gloria's spawn with a free tile beside it to stand on
const treeSpot = await a.evaluate(
  ([spawnA, spawnB]) => {
    const tp = window.__tp;
    const w = tp.player.world;
    const buildingTiles = new Set(tp.buildings.flatMap((x) => x.tiles));
    const seen = new Set([spawnA]);
    let ring = [spawnA];
    for (let d = 0; d < 12; d++) {
      const next = [];
      for (const k of ring)
        for (const n of tp.neighbors(k)) {
          if (seen.has(n)) continue;
          seen.add(n);
          next.push(n);
          // blocked for a flyer: a tree or a building, never water; no boxes stand yet
          if (!w.isBlockedFor(n, "bee") || buildingTiles.has(n)) continue;
          const stand = tp.neighbors(n).find((s) => tp.walkable(s) && s !== spawnA && s !== spawnB);
          if (stand !== undefined) return { tree: n, stand };
        }
      ring = next;
    }
    return null;
  },
  [SPAWN_A, SPAWN_B],
);
check(treeSpot !== null, "a tree near gloria's spawn with a free tile beside it");
await compose(a, "Under the old tree, or a little to the left of it.");
await a.evaluate(({ tree, stand }) => {
  window.__tp.teleport(stand);
  window.__tp.lookAt(tree);
}, treeSpot);
await a.waitForFunction((t) => window.__tp.placing().tiles[0] === t && window.__tp.placing().ok.length === 1, treeSpot.tree, { timeout: 5000 });
let st = await pl(a);
check(st.size === "s" && st.tiles.length === 1 && st.tiles[0] === treeSpot.tree && st.ok[0] === false, "an S shade over a tree is red");
check(await a.evaluate(() => document.getElementById("pl-put").disabled), "Put it down is disabled while the shade is red");
check(
  await a.evaluate(() => getComputedStyle(document.getElementById("box-labels")).display === "none"),
  "the floating labels step aside while placing",
);
await shot(a, "01-shade-red-tree");
await tapOrClick(a, '#pl-sizes [data-size="m"]');
await a.waitForFunction(() => window.__tp.placing().size === "m" && window.__tp.placing().ok.length === window.__tp.placing().tiles.length, null, { timeout: 5000 });
st = await pl(a);
const treeAt = st.tiles.indexOf(treeSpot.tree);
check(
  st.tiles.length === 4 && treeAt >= 0 && st.ok[treeAt] === false,
  `an M shade over the tree is red on the tree's tile (${JSON.stringify(st.ok)})`,
);
await shot(a, "02-shade-m-tree");
// turn toward open grass: an all-green M shade
st = await aimGreenOnGlobe(a, treeSpot.stand);
check(st !== null && st.size === "m" && st.tiles.length === 4, "an M shade on open grass is all green");
check(await a.evaluate(() => !document.getElementById("pl-put").disabled), "Put it down is enabled on green");
await shot(a, "03-shade-green-grass");
const greenTiles = st.tiles;
await confirm(a);
await a.waitForFunction(() => window.__tp.treasures.list().length === 1, null, { timeout: 15000 });
const mBox = (await a.evaluate(() => window.__tp.treasures.list()))[0];
check(mBox.loc === "globe" && mBox.size === "m" && sameTiles(mBox.tiles, greenTiles), `the M box stands on exactly the green tiles (${mBox.tiles} vs ${greenTiles})`);
await a.waitForTimeout(400);
check((await labels(a)).length === 0, "no label floats over a sealed, unlabelled box");
await shot(a, "04-m-box-down");
// her back to the tree: it fades rather than filling the camera's view
await a.evaluate(({ tree, stand }) => {
  const tp = window.__tp;
  const w = tp.player.world;
  const at = (k) => w.tilePos(k, 0, tp.player.pos.clone());
  const away = tp.neighbors(stand).sort((x, y) => at(y).distanceTo(at(tree)) - at(x).distanceTo(at(tree)))[0];
  tp.teleport(stand);
  tp.lookAt(away);
}, treeSpot);
await a.waitForFunction((t) => `tree${t}` in window.__tp.fade(), treeSpot.tree, { timeout: 5000 }).catch(() => {});
check(`tree${treeSpot.tree}` in (await a.evaluate(() => window.__tp.fade())), "the tree behind her fades out of the camera's way");
await a.waitForTimeout(400);
await shot(a, "04b-tree-fades");

// ---- khurlee keeps it with a label, sets it down on the globe, and picks it up again
const approach = (p, tile, avoid) =>
  p.evaluate(
    ([t, av]) => {
      const tp = window.__tp;
      const w = tp.player.world;
      const spot = w.neighbors(t).find((n) => !av.includes(n) && tp.walkable(n));
      tp.teleport(spot);
      tp.lookAt(t);
    },
    [tile, avoid],
  );
// A steps out of the way, onto her spawn
await a.evaluate((s) => window.__tp.teleport(s), SPAWN_A);
await approach(b, mBox.tiles[0], [SPAWN_A, ...mBox.tiles]);
await b.waitForFunction(() => !document.getElementById("box-btn").hidden, { timeout: 5000 });
await b.keyboard.press("e");
await b.waitForFunction(() => !document.getElementById("postcard").hidden, { timeout: 10000 });
await b.focus("#postcard input.pc-label");
await b.keyboard.type("our first summer");
await b.click("#pc-keep");
await b.waitForFunction(() => document.getElementById("postcard").hidden, { timeout: 5000 });
await waitBox(b, mBox.id, "loc", null);
check((await boxById(b, mBox.id)).label === "our first summer", "B kept the M box with a label");
await b.click("#treasure-open");
await b.click("#treasure-mine .tr-place");
st = await aimGreenOnGlobe(b, mBox.tiles[0], [SPAWN_A]);
check(st !== null && st.size === "m", "B's kept box shows an all-green M shade on the globe");
await confirm(b);
await waitBox(b, mBox.id, "loc", "globe");
await b.waitForTimeout(500);
let bl = await labels(b);
check(bl.length === 1 && bl[0].text === "our first summer" && onScreen(bl[0], ...viewport), `B sees the label float over the box on the globe (${JSON.stringify(bl)})`);
await shot(b, "05-label-globe");
// A walks up too: the label floats for her as well
await waitBox(a, mBox.id, "loc", "globe");
const bNow = await b.evaluate(() => window.__tp.player.tile);
await approach(a, (await boxById(a, mBox.id)).tiles[0], [bNow, ...(await boxById(a, mBox.id)).tiles]);
await a.waitForTimeout(500);
const al = await labels(a);
check(al.length === 1 && al[0].text === "our first summer", `A sees the same label (${JSON.stringify(al)})`);
await shot(a, "06-label-globe-partner");
// B picks it up again to carry it into the Copper Hall
await approach(b, (await boxById(b, mBox.id)).tiles[0], [await a.evaluate(() => window.__tp.player.tile), ...(await boxById(b, mBox.id)).tiles]);
await b.waitForFunction(() => !document.getElementById("box-btn").hidden, { timeout: 5000 });
await b.click("#box-btn");
await b.waitForFunction(() => !document.getElementById("postcard").hidden, { timeout: 10000 });
await b.click("#pc-keep"); // Pick it up
await waitBox(b, mBox.id, "loc", null);
await b.waitForTimeout(300);
check((await labels(b)).length === 0, "picked up, the label goes with the box");

// ---- the Hive: an L box aimed over the S spine, then into an L bay; an S box on an S shelf
await a.evaluate(() => window.__tp.enterBuilding(window.__tp.buildings.find((x) => x.id === "hive")));
await a.waitForTimeout(600);
await compose(a, "The biggest box for the biggest day.");
await tapOrClick(a, '#pl-sizes [data-size="l"]');
// from the aisle at (11, 20), facing the S spine: rows 12..15, columns 19..21
st = await aimInHall(a, 11, 20, 1, 0);
const spine = st.tiles.filter((k) => k % W === 12 || k % W === 13);
const aisle = st.tiles.filter((k) => k % W === 14 || k % W === 15);
check(
  st.size === "l" && st.tiles.length === 12 && spine.length === 6 && spine.every((k) => st.ok[st.tiles.indexOf(k)] === false),
  "in the Hive an L shade over the S spine is red on the shelves and pillars",
);
check(aisle.every((k) => st.ok[st.tiles.indexOf(k)] === true), "and green on the open aisle beyond it");
check(await a.evaluate(() => document.getElementById("pl-put").disabled), "Put it down stays disabled over the S spine");
await shot(a, "07-hive-l-over-s-red");
// from the left aisle at (4, 35), facing the left wall: the last L bay, (0..3, 34..36)
st = await aimInHall(a, 4, 35, -1, 0);
const lBay = [];
for (let i = 0; i <= 3; i++) for (let j = 34; j <= 36; j++) lBay.push(key(i, j));
check(sameTiles(st.tiles, lBay) && st.ok.every(Boolean), "an L shade fills the L bay, all green");
await shot(a, "08-hive-l-bay-green");
const before = (await a.evaluate(() => window.__tp.treasures.list())).map((x) => x.id);
await confirm(a);
await a.waitForFunction((n) => window.__tp.treasures.list().some((x) => !n.includes(x.id) && x.loc === "hive"), before, { timeout: 15000 });
const hiveL = await a.evaluate((n) => window.__tp.treasures.list().find((x) => !n.includes(x.id)), before);
check(hiveL.size === "l" && hiveL.loc === "hive" && sameTiles(hiveL.tiles, lBay), "the L box stands in the L bay");
await a.waitForTimeout(300);
check(Math.abs((await mounted(a, hiveL.id)).y - PLINTH_H) < 1e-6, "the L box stands on the plinth, half a unit up");
await shot(a, "09-hive-l-in-bay");
// an S box onto the S shelf at (12, 34), from the aisle at (11, 34)
await compose(a, "A small one for the shelf.");
st = await aimInHall(a, 11, 34, 1, 0);
check(st.size === "s" && st.tiles.length === 1 && st.tiles[0] === key(12, 34) && st.ok[0], "an S shade on the S shelf is green");
await shot(a, "10-hive-s-shelf-green");
const before2 = (await a.evaluate(() => window.__tp.treasures.list())).map((x) => x.id);
await confirm(a);
await a.waitForFunction((n) => window.__tp.treasures.list().some((x) => !n.includes(x.id) && x.loc === "hive"), before2, { timeout: 15000 });
const hiveS = await a.evaluate((n) => window.__tp.treasures.list().find((x) => !n.includes(x.id)), before2);
check(hiveS.size === "s" && sameTiles(hiveS.tiles, [key(12, 34)]), "the S box stands on the S shelf");
await a.waitForTimeout(300);
check(Math.abs((await mounted(a, hiveS.id)).y - PLINTH_H) < 1e-6, "the S box stands on the shelf's plinth");
check((await labels(a)).length === 0, "no labels over the Hive's sealed, unlabelled boxes");
await a.evaluate((k) => {
  const tp = window.__tp;
  tp.player.enterWorld(tp.player.world, k, tp.player.forward.clone().set(0, 0, -1));
  tp.zoom(0.55);
}, key(10, 40));
await a.waitForTimeout(1200);
await shot(a, "11-hive-two-boxes");

// ---- the Copper Hall: one box of each size in a matching bay ----------------
await b.evaluate(() => window.__tp.enterBuilding(window.__tp.buildings.find((x) => x.id === "hall")));
await b.waitForTimeout(600);
if (await b.isHidden("#treasure-panel")) await b.click("#treasure-open");
await b.click("#treasure-mine .tr-place");
await b.waitForFunction(() => window.__tp.placing().active, null, { timeout: 5000 });
check(await b.isHidden("#pl-sizes"), "a kept box keeps its size: no size buttons");
// the last M bay facing the left aisle, (6..7, 35..36), from (5, 35)
st = await aimInHall(b, 5, 35, 1, 0);
const mBay = [key(6, 35), key(7, 35), key(6, 36), key(7, 36)];
check(st.size === "m" && sameTiles(st.tiles, mBay) && st.ok.every(Boolean), "the kept M box's shade fills an M bay, all green");
await shot(b, "12-hall-m-bay-green");
await confirm(b);
await waitBox(b, mBox.id, "loc", "hall");
check(sameTiles((await boxById(b, mBox.id)).tiles, mBay), "the labelled M box stands in the M bay");
// a new S onto the S shelf (13, 34) facing the right aisle, from (14, 34)
await compose(b, "Something small for your shelf.");
st = await aimInHall(b, 14, 34, -1, 0);
check(st.size === "s" && st.tiles[0] === key(13, 34) && st.ok[0], "an S shade on an S shelf in the Copper Hall is green");
let ids = (await b.evaluate(() => window.__tp.treasures.list())).map((x) => x.id);
await confirm(b);
await b.waitForFunction((n) => window.__tp.treasures.list().some((x) => !n.includes(x.id) && x.loc === "hall"), ids, { timeout: 15000 });
const hallS = await b.evaluate((n) => window.__tp.treasures.list().find((x) => !n.includes(x.id)), ids);
check(hallS.size === "s" && sameTiles(hallS.tiles, [key(13, 34)]), "the S box stands on the S shelf");
// a new L into the right wall's last L bay, (16..19, 34..36), from (15, 35)
await compose(b, "And a big one by the wall.");
await tapOrClick(b, '#pl-sizes [data-size="l"]');
st = await aimInHall(b, 15, 35, 1, 0);
const rBay = [];
for (let i = 16; i <= 19; i++) for (let j = 34; j <= 36; j++) rBay.push(key(i, j));
check(st.size === "l" && sameTiles(st.tiles, rBay) && st.ok.every(Boolean), "an L shade fills the right wall's L bay, all green");
await shot(b, "13-hall-l-bay-green");
ids = (await b.evaluate(() => window.__tp.treasures.list())).map((x) => x.id);
await confirm(b);
await b.waitForFunction((n) => window.__tp.treasures.list().some((x) => !n.includes(x.id) && x.loc === "hall"), ids, { timeout: 15000 });
const hallL = await b.evaluate((n) => window.__tp.treasures.list().find((x) => !n.includes(x.id)), ids);
check(hallL.size === "l" && sameTiles(hallL.tiles, rBay), "the L box stands in the L bay");
await b.waitForTimeout(400);
const ys = await Promise.all([mBox.id, hallS.id, hallL.id].map((id) => mounted(b, id)));
check(ys.every((m) => m && Math.abs(m.y - PLINTH_H) < 1e-6), `all three stand on their plinths (${ys.map((m) => m?.y).join(", ")})`);
// the labelled M box shows its label, the unlabelled S and L do not
// from the entrance hall, zoomed out a little: all three chests in view
await b.evaluate((k) => {
  const tp = window.__tp;
  tp.player.enterWorld(tp.player.world, k, tp.player.forward.clone().set(0, 0, -1));
  tp.zoom(0.55);
}, key(10, 41 - 1));
await b.waitForTimeout(1200);
// every mounted tag, on screen or not: only the labelled box has one
const tags = await b.evaluate(() => [...document.querySelectorAll("#box-labels .box-label")].map((e) => e.textContent));
check(tags.length === 1 && tags[0] === "our first summer", `one tag in the Copper Hall, for the labelled box only (${JSON.stringify(tags)})`);
await shot(b, "14-hall-three-boxes");
// up close in front of the M bay, the tag floats above the chest
await b.evaluate((k) => {
  const tp = window.__tp;
  tp.player.enterWorld(tp.player.world, k, tp.player.forward.clone().set(1, 0, 0));
  tp.zoom(0.3);
}, key(5, 35));
await b.waitForTimeout(1200);
bl = await labels(b);
check(bl.length === 1 && bl[0].text === "our first summer" && onScreen(bl[0], ...viewport), `up close the tag floats on screen (${JSON.stringify(bl)})`);
await shot(b, "15-hall-label-close");

// ---- the Copper Hall full of labelled boxes -------------------------------------
/** A leaves a box straight into a bay of `loc`; B opens it (if asked), keeps it with `label` and puts it back. */
async function labelledBox(loc, size, tiles, fwd, label, open = false) {
  const ids = (await a.evaluate(() => window.__tp.treasures.list())).map((x) => x.id);
  await a.evaluate(
    ([l, sz, t, f]) =>
      window.__tp.net.placeBox({ size: sz, contents: { style: "note", text: "for the hall", media: [] }, announce: false, loc: l, tiles: t, fwd: f }),
    [loc, size, tiles, fwd],
  );
  await b.waitForFunction((n) => window.__tp.treasures.list().some((x) => !n.includes(x.id)), ids, { timeout: 10000 });
  const box = await b.evaluate((n) => window.__tp.treasures.list().find((x) => !n.includes(x.id)), ids);
  if (open) {
    await b.evaluate((id) => window.__tp.net.openBox(id), box.id);
    await b.waitForFunction((id) => window.__tp.treasures.list().find((x) => x.id === id)?.opened != null, box.id, { timeout: 10000 });
  }
  await b.evaluate(([id, l]) => window.__tp.net.keepBox(id, l), [box.id, label]);
  await waitBox(b, box.id, "loc", null);
  await b.evaluate(([id, l, t, f]) => window.__tp.net.putBox(id, l, t, f), [box.id, loc, tiles, fwd]);
  await waitBox(b, box.id, "loc", loc);
  return box.id;
}
const rect = (i0, i1, j0, j1) => {
  const out = [];
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) out.push(key(i, j));
  return out;
};
const FAR_LABEL = "grandma's letters";
const hallBoxes = [
  // [size, tiles, facing of the one who put it down, label, opened]
  ["l", rect(0, 3, 30, 32), [-1, 0, 0], "Lisbon, the whole trip", true],
  ["l", rect(16, 19, 26, 28), [1, 0, 0], "winter things"],
  ["l", rect(0, 3, 14, 16), [-1, 0, 0], "the far corner"],
  ["m", rect(6, 7, 23, 24), [1, 0, 0], FAR_LABEL],
  ["m", rect(6, 7, 29, 30), [1, 0, 0], "concert tickets"],
  ["m", rect(8, 9, 32, 33), [-1, 0, 0], "recipes"],
  ["m", rect(8, 9, 17, 18), [-1, 0, 0], "old photos"],
  ["s", [key(12, 30)], [1, 0, 0], "the ring"],
  ["s", [key(13, 26)], [-1, 0, 0], "shells"],
  ["s", [key(12, 22)], [1, 0, 0], "a pressed flower"],
  ["s", [key(8, 37)], [0, 0, -1], "for later"],
];
const hallIds = {};
for (const [size, tiles, fwd, label, open] of hallBoxes) hallIds[label] = await labelledBox("hall", size, tiles, fwd, label, open);
check(Object.keys(hallIds).length === hallBoxes.length, `${hallBoxes.length} labelled boxes stand in the Copper Hall`);
// zoomed all the way out at the door: the tag of the M bay halfway down the hall shows
await b.evaluate((k) => {
  const tp = window.__tp;
  tp.player.enterWorld(tp.player.world, k, tp.player.forward.clone().set(0, 0, -1));
  tp.zoom(1);
}, key(10, 40));
await b.waitForTimeout(1800);
bl = await labels(b);
const far = bl.find((l) => l.text === FAR_LABEL);
const farDist = await b.evaluate(
  (k) => {
    const tp = window.__tp;
    const at = tp.player.world.tilePos(k, 0, tp.player.pos.clone());
    return at.distanceTo(tp.player.pos.clone().fromArray(tp.camPos()));
  },
  key(6, 23),
);
check(
  far !== undefined && onScreen(far, ...viewport) && farDist > 40,
  `fully zoomed out at the door, a tag on a bay ${farDist.toFixed(0)} units away shows (${bl.length} tags on screen)`,
);
await shot(b, "16-hall-labels-wide");
// the same from halfway down the hall, zoomed out part of the way
await b.evaluate((k) => {
  const tp = window.__tp;
  tp.player.enterWorld(tp.player.world, k, tp.player.forward.clone().set(0, 0, -1));
  tp.zoom(0.6);
}, key(10, 36));
await b.waitForTimeout(1500);
await shot(b, "17-hall-labels-mid");
// across the aisle from the opened L box: its tag sits just above the chest, well below the top of the upright lid
await b.evaluate((k) => {
  const tp = window.__tp;
  tp.player.enterWorld(tp.player.world, k, tp.player.forward.clone().set(-1, 0, 0));
  tp.zoom(0.55);
}, key(5, 31));
await b.waitForTimeout(1500);
bl = await labels(b);
const lisbon = bl.find((l) => l.text === "Lisbon, the whole trip");
check(lisbon !== undefined && onScreen(lisbon, ...viewport), `up close the opened L box's tag shows (${JSON.stringify(lisbon)})`);
await shot(b, "18-hall-opened-l-label");

// ---- a tour of both halls ----------------------------------------------------
/** Stands `p` on (i, j) facing (dx, dz) at zoom fraction `z`, lets the camera settle, and shoots. */
async function view(p, name, i, j, dx, dz, z) {
  await p.evaluate(
    ([k, x, y, f]) => {
      const tp = window.__tp;
      tp.player.enterWorld(tp.player.world, k, tp.player.forward.clone().set(x, 0, y).normalize());
      tp.zoom(f);
    },
    [key(i, j), dx, dz, z],
  );
  await p.waitForTimeout(1200);
  await shot(p, name);
}
for (const [p, id] of [[a, "hive"], [b, "hall"]]) {
  check((await p.evaluate(() => window.__tp.debug().loc)) === id, `touring the ${id}`);
  await view(p, `20-${id}-entrance`, 10, 40, 0, -1, 0.25);
  await view(p, `21-${id}-entrance-wide`, 10, 40, 0, -1, 1);
  const walls = await p.evaluate(() => window.__tp.walls());
  check(walls.near === false && walls.far === true, `from the door the camera looks in through the near wall (${JSON.stringify(walls)})`);
  await view(p, `22-${id}-left-aisle`, 4, 30, 0, -1, 0.35);
  await view(p, `23-${id}-m-spine`, 5, 20, 1, -0.4, 0.3);
  await view(p, `24-${id}-s-spine`, 11, 18, 1, -0.3, 0.3);
  await view(p, `25-${id}-far-wall`, 10, 1, 0, -1, 0.4);
  await view(p, `26-${id}-back-to-door`, 10, 2, 0, 1, 1);
  const back = await p.evaluate(() => window.__tp.walls());
  check(back.far === false && back.near === true, `turned to the door, the far wall and its lamps hide (${JSON.stringify(back)})`);
  await p.evaluate(() => window.__tp.zoom(0.25));
}

// ---- both exteriors from a few tiles away ------------------------------------
/** Stands `p` a few tiles out from building `id`'s doorstep and turns to face the building. */
async function exterior(p, id, name) {
  await p.evaluate((i) => {
    const tp = window.__tp;
    tp.leaveBuilding();
    const bd = tp.buildings.find((x) => x.id === i);
    const bt = new Set(bd.tiles);
    // walk away from the house: each step to the free neighbor farthest from it
    const w = tp.player.world;
    const home = w.tilePos(bd.tiles[0], 0, tp.player.pos.clone());
    const away = (t) => w.tilePos(t, 0, tp.player.pos.clone()).distanceTo(home);
    let at = bd.doorTiles[0];
    for (let n = 0; n < 4; n++) {
      const next = tp.neighbors(at).filter((t) => tp.walkable(t) && !bt.has(t) && away(t) > away(at));
      if (next.length === 0) break;
      at = next.sort((x, y) => away(y) - away(x))[0];
    }
    tp.teleport(at);
    tp.lookAt(bd.tiles[0]);
  }, id);
  await p.waitForTimeout(1200);
  await shot(p, name);
}
await exterior(a, "hive", "30-hive-outside");
await exterior(b, "hall", "31-hall-outside");

// ---- an opened, labelled L box on the globe ----------------------------------------
// khurlee leaves an L box on open grass; gloria opens it, keeps it with a label and puts it back
await compose(b, "Something big, out in the open.");
await tapOrClick(b, '#pl-sizes [data-size="l"]');
const bSpot = await b.evaluate(() => window.__tp.player.tile);
st = await aimGreenOnGlobe(b, bSpot, [await a.evaluate(() => window.__tp.player.tile)]);
check(st !== null && st.size === "l" && st.tiles.length === 12, "an L shade on open grass is all green");
ids = (await b.evaluate(() => window.__tp.treasures.list())).map((x) => x.id);
await confirm(b);
await a.waitForFunction((n) => window.__tp.treasures.list().some((x) => !n.includes(x.id) && x.loc === "globe"), ids, { timeout: 15000 });
const globeL = await a.evaluate((n) => window.__tp.treasures.list().find((x) => !n.includes(x.id)), ids);
await a.evaluate((id) => window.__tp.net.openBox(id), globeL.id);
await a.waitForFunction((id) => window.__tp.treasures.list().find((x) => x.id === id)?.opened != null, globeL.id, { timeout: 10000 });
await a.evaluate((id) => window.__tp.net.keepBox(id, "our picnic things"), globeL.id);
await waitBox(a, globeL.id, "loc", null);
await a.evaluate(([id, t, f]) => window.__tp.net.putBox(id, "globe", t, f), [globeL.id, globeL.tiles, globeL.fwd]);
await waitBox(b, globeL.id, "loc", "globe");
await b.waitForTimeout(1200);
bl = await labels(b);
check(bl.some((l) => l.text === "our picnic things" && onScreen(l, ...viewport)), `the opened L box's tag floats over it on the globe (${JSON.stringify(bl)})`);
await shot(b, "32-globe-opened-l-label");
await b.evaluate(() => window.__tp.zoom(0.1));
await b.waitForTimeout(1200);
await shot(b, "33-globe-opened-l-label-close");

await browser.close();
console.log(process.exitCode ? "HOUSES FAILED" : "HOUSES PASSED");
