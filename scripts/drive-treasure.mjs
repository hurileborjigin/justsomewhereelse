// Visual check for treasure boxes: A writes a postcard with a photo and her own
// dressing and leaves an S box; B walks up, opens it, keeps it with a label,
// carries it into the ger and places it there, relabels it with a long label
// and picks it up again. Act 2: a plain note, a photo-only box, and A taking a
// sealed box back.
// Screenshots land in /tmp/tinyplanet-treasure-*.png.
// Run against a FRESH database so both players start at their spawn tiles:
//   DB_PATH=/tmp/tp-drive.db PLANET_PASS=planet npm run dev
//   node scripts/drive-treasure.mjs
// MOBILE=1 drives a 390x844 touch phone instead of a 1280x800 desktop.
import { chromium } from "playwright-core";
import { headlessShell } from "./_browser.mjs";

const URL = process.argv[2] ?? "http://localhost:5173";
const MOBILE = process.env.MOBILE === "1";
const shot = (page, name) => page.screenshot({ path: `/tmp/tinyplanet-treasure-${name}.png` });
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

// ---- A composes and leaves an S box with a photo -------------------------
await a.click("#treasure-open");
await a.click("#treasure-leave");
await a.waitForSelector("#postcard textarea.pc-text");
await a.fill("#postcard textarea.pc-text", "Dear khurlee,\n\nI hid this where the grass is softest.\nOpen it when you miss me.");
await a.keyboard.press("Enter"); // a newline on the card, never a jump to the chat box
await a.keyboard.type("🐝");
check(
  (await a.evaluate(() => document.activeElement?.tagName)) === "TEXTAREA",
  "Enter inside the postcard keeps writing on the card",
);
check((await a.inputValue("#postcard textarea.pc-text")).endsWith("miss me.\n🐝"), "the newline landed in the text");
const photo = await b.screenshot(); // any real PNG will do as the "photo"
await a.setInputFiles("#pc-file", { name: "view.png", mimeType: "image/png", buffer: photo });
// the sender dresses the card herself: stamp, recipient, place, signature
await a.fill("#postcard .pc-stamp-in", "🌙");
await a.fill("#postcard .pc-to-in", "my love");
await a.fill("#postcard .pc-place-in", "Sydney");
await a.fill("#postcard .pc-from-in", "your bee");
check(
  (await a.textContent("#postcard .pc-stamp small")) === "Sydney" &&
    (await a.textContent("#postcard .pc-postmark span:nth-child(2)")) === "Sydney",
  "the stamp caption and the postmark echo the place as it is typed",
);
const fitsAll = await a.evaluate(() => [...document.querySelectorAll("#postcard .pc-sizes button")].every((x) => !x.disabled));
check(
  (await a.locator("#postcard .pc-hint").count()) === (fitsAll ? 0 : 1),
  `the size hint shows exactly when a size is greyed out (all fit: ${fitsAll})`,
);
await a.click('#postcard [data-size="s"]');
await a.evaluate(() => document.fonts.ready);
await shot(a, "A1-compose");
await a.click("#pc-send");
await a.waitForFunction(() => document.getElementById("postcard").hidden, { timeout: 15000 });
await a.waitForTimeout(500);
const box = await a.evaluate(() => window.__tp.treasures.list()[0]);
check(box && box.size === "s" && box.loc === "globe" && box.tiles.length === 1, "A's box stands on the globe");
await shot(a, "A2-placed");
await shot(b, "B2-sees-box");
const sealedForB = await b.evaluate(() => window.__tp.treasures.list()[0]);
check(sealedForB && sealedForB.text === undefined, "B cannot read the sealed box");
check((await b.textContent("#treasure-badge")) === "1", "B's chest badge announces one waiting box");
const badge = await b.evaluate(() => {
  const r = document.getElementById("treasure-badge").getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height) };
});
check(badge.h >= 14 && badge.w >= 14, `the badge is a real pill, not a sliver (${badge.w}x${badge.h})`);

// ---- B walks up, opens, keeps ----------------------------------------------
await b.evaluate((tile) => {
  const tp = window.__tp;
  const w = tp.player.world;
  const spot = w.neighbors(tile).find((n) => !w.isBlockedFor(n, "donkey"));
  tp.teleport(spot);
  tp.lookAt(tile);
}, box.tiles[0]);
await b.waitForFunction(() => !document.getElementById("box-btn").hidden, { timeout: 5000 });
check((await b.textContent("#box-btn")).includes("Open the treasure box"), "B is offered the box");
await shot(b, "B3-adjacent");
await b.keyboard.press("e");
await b.waitForFunction(() => !document.getElementById("postcard").hidden, { timeout: 10000 });
await b.evaluate(() => document.fonts.ready);
await b.waitForTimeout(700); // lid tween on both screens
check(
  (await b.textContent("#postcard .pc-stamp span")) === "🌙" &&
    (await b.textContent("#postcard .pc-to b")) === "my love" &&
    (await b.textContent("#postcard .pc-postmark span:nth-child(2)")) === "Sydney" &&
    (await b.textContent("#postcard .pc-from")) === "from your bee",
  "the reader sees the dressing the sender chose",
);
await shot(b, "B4-postcard");
await shot(a, "A4-lid-open");
// Enter inside the card is a newline for the writer, never a jump to chat:
await b.focus("#postcard input.pc-label");
await b.keyboard.type("the softest grass");
check((await b.evaluate(() => document.activeElement?.className)) === "pc-label", "label input keeps focus");
await b.click("#pc-keep");
await b.waitForFunction(() => document.getElementById("postcard").hidden);
await b.waitForFunction(() => window.__tp.treasures.list()[0].loc === null, { timeout: 5000 });
const kept = await b.evaluate(() => window.__tp.treasures.list()[0]);
check(kept.owner === 1 && kept.label === "the softest grass", "B kept it with a label");
check((await a.evaluate(() => window.__tp.treasures.list()[0].loc)) === null, "the chest left A's world too");
await b.click("#treasure-open");
await shot(b, "B5-collection");

// ---- B carries it into the ger and places it -------------------------------
await b.evaluate(() => window.__tp.enterBuilding(window.__tp.buildings.find((x) => x.kind === "ger")));
await b.waitForTimeout(600);
await b.click("#treasure-mine .tr-place");
await b.waitForFunction(() => window.__tp.treasures.list()[0].loc === "ger", { timeout: 5000 });
await b.waitForTimeout(500);
await shot(b, "B6-in-the-ger");
await a.evaluate(() => window.__tp.enterBuilding(window.__tp.buildings.find((x) => x.kind === "ger")));
await a.waitForTimeout(600);
await shot(a, "A6-visits-the-ger");
const finalA = await a.evaluate(() => window.__tp.treasures.list()[0]);
check(finalA.loc === "ger" && finalA.text !== undefined, "A sees the placed box and still reads her own words");

// ---- B relabels it with a long label, then picks it up again ----------------
const LONG = "the softest grass on the whole planet!!!"; // BOX_LABEL_MAX_LEN characters
check(LONG.length === 40, "the long label is 40 characters");
await b.click("#treasure-min");
b.once("dialog", (d) => d.accept(LONG));
await b.click("#treasure-open");
await b.click("#treasure-mine .tr-label");
await b.waitForFunction((l) => window.__tp.treasures.list()[0].label === l, LONG, { timeout: 5000 });
await b.click("#treasure-min");
await b.waitForFunction(() => !document.getElementById("box-btn").hidden, { timeout: 5000 });
await b.waitForTimeout(300);
const btn = await b.evaluate(() => {
  const e = document.getElementById("box-btn");
  const r = e.getBoundingClientRect();
  return { left: r.left, right: r.right, width: r.width, clipped: e.scrollWidth > e.clientWidth, vw: innerWidth };
});
console.log(`  box button with a 40-character label: ${JSON.stringify(btn)}`);
check(btn.left >= 16 - 0.5 && btn.right <= btn.vw - 16 + 0.5, "the box button stays inside the screen with a 16px gutter");
await shot(b, "B7-long-label");
await b.click("#box-btn"); // B stands on the ger's door tile: E would mean "go back outside"
await b.waitForFunction(() => !document.getElementById("postcard").hidden, { timeout: 10000 });
check((await b.textContent("#pc-keep")).startsWith("Pick it up"), "the owner is offered to pick it up, not to keep it");
check((await b.inputValue("#postcard input.pc-label")) === LONG, "the label field shows the box's label");
await b.evaluate(() => document.fonts.ready);
await shot(b, "B8-pick-up");
await b.focus("#postcard input.pc-label");
await b.keyboard.press("Enter");
await b.waitForFunction(() => document.getElementById("postcard").hidden, { timeout: 5000 });
await b.waitForFunction(() => window.__tp.treasures.list()[0].loc === null, { timeout: 5000 });
const picked = await b.evaluate(() => window.__tp.treasures.list()[0]);
check(picked.owner === 1 && picked.label === LONG, "Enter in the label field picks it up, label kept");

// ---- Act 2: back on the globe. A note, a photo box, and taking one back --------
const SPAWN_A = 646; // key(2, 6, 8)
const SPAWN_B = 649; // key(2, 9, 8), three tiles ahead of A
const home = (p, tile, look) =>
  p.evaluate(
    ([t, l]) => {
      const tp = window.__tp;
      tp.leaveBuilding();
      tp.teleport(t);
      tp.lookAt(l);
    },
    [tile, look],
  );
/** B steps next to `tile` (never onto A's tile) and faces it. */
const approach = (p, tile, avoid) =>
  p.evaluate(
    ([t, av]) => {
      const tp = window.__tp;
      const w = tp.player.world;
      const spot = w.neighbors(t).find((n) => n !== av && !w.isBlockedFor(n, "donkey"));
      tp.teleport(spot);
      tp.lookAt(t);
    },
    [tile, avoid],
  );
const readOpen = async (p) => {
  await p.waitForFunction(() => !document.getElementById("box-btn").hidden, { timeout: 5000 });
  await p.keyboard.press("e");
  await p.waitForFunction(() => !document.getElementById("postcard").hidden, { timeout: 10000 });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(400);
};
const keep = async (p) => {
  await p.click("#pc-keep");
  await p.waitForFunction(() => document.getElementById("postcard").hidden, { timeout: 5000 });
  await p.waitForTimeout(400);
};
await home(a, SPAWN_A, SPAWN_B);
await home(b, SPAWN_B, SPAWN_A);
await a.waitForTimeout(500);

// a plain note
await a.click("#treasure-open");
await a.click("#treasure-leave");
await a.click('#postcard [data-style="note"]');
await a.fill("#postcard textarea.pc-text", "Just a quick one:\nthe kettle is on. Come home when you can.");
await a.evaluate(() => document.fonts.ready);
await shot(a, "C1-note-compose");
await a.click("#pc-send");
await a.waitForFunction(() => document.getElementById("postcard").hidden, { timeout: 15000 });
await a.waitForTimeout(400);
const note = await a.evaluate(() => window.__tp.treasures.list().find((x) => x.style === "note"));
check(note && note.loc === "globe", "A's note stands on the globe");
await approach(b, note.tiles[0], SPAWN_A);
await readOpen(b);
check(
  (await b.locator("#postcard .pc-note").count()) === 1 && (await b.locator("#postcard .pc-card").count()) === 0,
  "a note reads as a plain sheet of paper, no postcard dressing",
);
await shot(b, "C2-note-read");
await keep(b);

// just photos, with a caption
await home(a, SPAWN_A, SPAWN_B);
await a.click("#treasure-open");
await a.click("#treasure-leave");
await a.click('#postcard [data-style="media"]');
await a.setInputFiles("#pc-file", { name: "one.png", mimeType: "image/png", buffer: photo });
await a.setInputFiles("#pc-file", { name: "two.png", mimeType: "image/png", buffer: await a.screenshot() });
await a.fill("#postcard textarea.pc-caption", "the view from up here");
await a.evaluate(() => document.fonts.ready);
await shot(a, "C3-photos-compose");
await a.click("#pc-send");
await a.waitForFunction(() => document.getElementById("postcard").hidden, { timeout: 20000 });
await a.waitForTimeout(400);
const photos = await a.evaluate(() => window.__tp.treasures.list().find((x) => x.style === "media"));
check(photos && photos.loc === "globe", "A's photo box stands on the globe");
await approach(b, photos.tiles[0], SPAWN_A);
await readOpen(b);
check(
  (await b.locator("#postcard .pc-prints.pc-big .pc-print").count()) === 2 &&
    (await b.textContent("#postcard .pc-caption-read")) === "the view from up here" &&
    (await b.locator("#postcard .pc-card, #postcard .pc-note").count()) === 0,
  "a photo box reads as big prints with the caption underneath",
);
await shot(b, "C4-photos-read");
await keep(b);

// taking a sealed box back
await home(a, SPAWN_A, SPAWN_B);
await a.click("#treasure-open");
await a.click("#treasure-leave");
await a.fill("#postcard textarea.pc-text", "Oops, wrong spot.");
await a.click("#pc-send");
await a.waitForFunction(() => document.getElementById("postcard").hidden, { timeout: 15000 });
await a.waitForTimeout(400);
const oops = await a.evaluate(() => window.__tp.treasures.list().find((x) => x.opened === null && x.creator === 0));
check(oops && oops.loc === "globe", "A's third box stands sealed on the globe");
await a.click("#treasure-open");
check((await a.locator("#treasure-left .tr-take").count()) === 1, "the panel offers Take back on the sealed box only");
await a.click("#treasure-min");
await readOpen(a); // A opens her own sealed box: the creator's view
check((await a.locator("#pc-take").count()) === 1 && (await a.textContent("#postcard .pc-footer")).startsWith("Still sealed"), "the creator sees Still sealed and Take it back");
await shot(a, "C5-own-sealed");
a.once("dialog", (d) => d.accept());
await a.click("#pc-take");
await a.waitForFunction(() => document.getElementById("postcard").hidden, { timeout: 5000 });
await a.waitForFunction((id) => !window.__tp.treasures.list().some((x) => x.id === id), oops.id, { timeout: 5000 });
await b.waitForFunction((id) => !window.__tp.treasures.list().some((x) => x.id === id), oops.id, { timeout: 5000 });
check(true, "the taken-back box vanished for both players");
await shot(a, "C6-taken-back");

await browser.close();
console.log(process.exitCode ? "DRIVE FAILED" : "done - screenshots in /tmp/tinyplanet-treasure-*.png");
