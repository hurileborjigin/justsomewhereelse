// Visual check for treasure boxes: A writes a postcard with a photo and leaves
// an S box; B walks up, opens it, keeps it with a label, carries it into the
// ger and places it there. Screenshots land in /tmp/tinyplanet-treasure-*.png.
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
check((await b.textContent("#treasure-badge")) === "1", "B's 🎁 badge announces one waiting box");

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

await browser.close();
console.log(process.exitCode ? "DRIVE FAILED" : "done - screenshots in /tmp/tinyplanet-treasure-*.png");
