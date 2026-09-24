// Visual check for treasure boxes: A writes a postcard, dresses it, frames an
// uploaded photo with a caption on its picture side and leaves an S box; B
// walks up, sees the picture first, flips to the words, keeps it with a label,
// carries it into the ger and places it there, relabels it with a long label
// and picks it up again. Act 1b: a postcard whose picture A takes in photo
// mode. Act 2: a plain note, a photo-only box, and A taking a sealed box back.
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
// the sender dresses the card herself: stamp, recipient, place, signature
await a.fill("#postcard .pc-stamp-in", "🌙");
await a.fill("#postcard .pc-to-in", "my love");
await a.fill("#postcard .pc-place-in", "Sydney");
await a.fill("#postcard .pc-from-in", "your bee");
// both faces are one card: the same box on screen, to the pixel
const faceBoxes = await a.evaluate(() =>
  [".pc-face-writing .pc-card", ".pc-face-picture"].map((s) => {
    const r = document.querySelector(`#postcard ${s}`).getBoundingClientRect();
    return [r.left, r.top, r.width, r.height];
  }),
);
check(
  faceBoxes[0].every((v, i) => Math.abs(v - faceBoxes[1][i]) <= 1),
  `the writing and the picture faces share one size (${faceBoxes.map((f) => f.map(Math.round).join(",")).join(" vs ")})`,
);
// the picture side: flip, upload, drag, zoom, caption
await a.click("#pc-turn");
await a.waitForTimeout(700); // the 0.6s turn
check((await a.locator("#postcard .pc-flipper.pc-flipped").count()) === 1, "the pill turns the card to the picture side");
check((await a.textContent("#pc-turn")) === "writing side ↻", "the pill now names the writing side");
await a.setInputFiles("#postcard .pc-picture-file", { name: "view.png", mimeType: "image/png", buffer: photo });
await a.waitForFunction(() => document.querySelector("#postcard .pc-photo")?.naturalWidth > 0);
const placed = () =>
  a.evaluate(() => {
    const s = document.querySelector("#postcard .pc-photo").style;
    const f = document.querySelector("#postcard .pc-picture");
    const [left, top, width, height] = [s.left, s.top, s.width, s.height].map(parseFloat);
    // the point of the photo under the frame's centre: the crop, whatever the frame's size
    const focus = [(f.clientWidth / 2 - left) / width, (f.clientHeight / 2 - top) / height];
    return { left, top, width, frame: [f.clientWidth, f.clientHeight], focus };
  });
const face = await a.locator("#postcard .pc-face-picture").boundingBox();
const cx = face.x + face.width / 2;
const cy = face.y + face.height / 2;
// at zoom 1 the photo only overhangs the card along one axis (x for a landscape
// shot on the desktop card, y for a portrait one on the phone card): drag along it
const start = await placed();
const alongX = start.width > face.width + 1;
const axis = alongX ? "left" : "top";
const at = (d) => (alongX ? [cx + d, cy] : [cx, cy + d]);
await a.mouse.move(cx, cy);
await a.mouse.down();
await a.mouse.move(...at(15), { steps: 3 });
await a.mouse.up();
const afterDrag = await placed();
check(afterDrag[axis] !== start[axis], `a drag moves the photo (${axis} ${start[axis]} -> ${afterDrag[axis]})`);
// an interrupted drag stops following the pointer
await a.mouse.move(cx, cy);
await a.mouse.down();
await a.mouse.move(...at(-5), { steps: 2 });
const atCancel = await placed();
await a.evaluate(() =>
  document.querySelector("#postcard .pc-photo").dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1, bubbles: true })),
);
await a.mouse.move(...at(-40), { steps: 4 });
await a.mouse.up();
const afterCancel = await placed();
check(
  atCancel[axis] !== afterDrag[axis] && afterCancel[axis] === atCancel[axis],
  `a cancelled drag leaves the photo where the cancel found it (${axis} ${afterDrag[axis]} -> ${atCancel[axis]}, then stays ${afterCancel[axis]})`,
);
// and the next drag works again
await a.mouse.move(cx, cy);
await a.mouse.down();
await a.mouse.move(...at(-20), { steps: 4 });
await a.mouse.up();
const afterThird = await placed();
check(afterThird[axis] !== afterCancel[axis], `the next drag moves the photo again (${axis} ${afterCancel[axis]} -> ${afterThird[axis]})`);
// a range input cannot be filled: set it the way a slider move does
await a.evaluate(() => {
  const z = document.querySelector("#postcard .pc-zoom");
  z.value = "1.6";
  z.dispatchEvent(new Event("input", { bubbles: true }));
});
const zoomed = await placed();
check(zoomed.width > afterThird.width, `the zoom slider enlarges the photo (width ${afterThird.width} -> ${zoomed.width})`);
await a.fill("#postcard .pc-cap-in", "🌙".repeat(70));
check([...(await a.inputValue("#postcard .pc-cap-in"))].length === 60, "the caption stops at 60 graphemes");
await a.fill("#postcard .pc-cap-in", "the view from the hill");
await a.evaluate(() => document.fonts.ready);
await shot(a, "A0-picture-side");
await a.click("#pc-turn");
await a.waitForTimeout(700);
check((await a.locator("#postcard .pc-flipper.pc-flipped").count()) === 0, "the pill turns the card back to the writing");
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
const senderPlaced = await placed();
await a.click("#pc-send");
await a.waitForFunction(() => document.getElementById("postcard").hidden, { timeout: 15000 });
await a.waitForTimeout(500);
let box = await a.evaluate(() => window.__tp.treasures.list()[0]);
check(box && box.size === "s" && box.loc === "globe" && box.tiles.length === 1, "A's box stands on the globe");

// ---- A changes her mind: edits the sealed box, then moves it one tile over -------
await a.waitForFunction(() => !document.getElementById("box-btn").hidden, { timeout: 5000 });
await a.keyboard.press("e");
await a.waitForFunction(() => !document.getElementById("postcard").hidden, { timeout: 10000 });
check(
  (await a.locator("#pc-edit").count()) === 1 &&
    (await a.locator("#pc-lift").count()) === 1 &&
    (await a.locator("#pc-take").count()) === 1,
  "the creator may edit, pick up or take back her sealed box",
);
await a.click("#pc-edit");
await a.waitForSelector("#postcard textarea.pc-text");
check(
  (await a.inputValue("#postcard textarea.pc-text")).startsWith("Dear khurlee,") &&
    (await a.inputValue("#postcard .pc-to-in")) === "my love" &&
    (await a.locator("#postcard .pc-print").count()) === 0 &&
    (await a.locator("#postcard .pc-photo").count()) === 1 &&
    (await a.inputValue("#postcard .pc-cap-in")) === "the view from the hill" &&
    (await a.locator("#postcard .pc-sizes").count()) === 0 &&
    (await a.textContent("#pc-send")) === "Save changes",
  "edit opens the card prefilled, picture side and caption included, no prints, no size picker",
);
await a.evaluate(() => document.fonts.ready);
await shot(a, "A1b-edit");
await a.fill("#postcard textarea.pc-text", `${await a.inputValue("#postcard textarea.pc-text")}\nP.S. I moved it a little.`);
await a.click("#pc-send");
await a.waitForFunction(() => document.getElementById("postcard").hidden, { timeout: 15000 });
await a.waitForFunction(() => window.__tp.treasures.list()[0].contents.writing.text.endsWith("I moved it a little."), { timeout: 5000 });
check((await b.evaluate(() => window.__tp.treasures.list()[0].contents)) === undefined, "B still cannot read the edited sealed box");
await a.waitForFunction(() => !document.getElementById("box-btn").hidden, { timeout: 5000 });
await a.keyboard.press("e");
await a.waitForFunction(() => !document.getElementById("postcard").hidden, { timeout: 10000 });
await a.click("#pc-lift");
await a.waitForFunction(() => window.__tp.treasures.list()[0].loc === null, { timeout: 5000 });
await b.waitForFunction(() => window.__tp.treasures.list()[0].loc === null, { timeout: 5000 });
check(
  (await a.evaluate(() => window.__tp.treasures.list()[0].loc)) === null &&
    (await b.evaluate(() => window.__tp.treasures.list()[0].loc)) === null,
  "the lifted chest left both worlds",
);
await a.evaluate((front) => {
  const tp = window.__tp;
  const w = tp.player.world;
  const other = w.neighbors(tp.player.tile).find((n) => n !== front && !w.isBlockedFor(n, "donkey"));
  tp.lookAt(other);
}, box.tiles[0]);
await a.click("#treasure-open");
check((await a.locator("#treasure-left .tr-place").count()) === 1, "the panel offers Place here for the box in her pocket");
await a.click("#treasure-left .tr-place");
await a.waitForFunction(() => window.__tp.treasures.list()[0].loc === "globe", { timeout: 5000 });
await a.click("#treasure-min");
await a.waitForTimeout(400);
const moved = await a.evaluate(() => window.__tp.treasures.list()[0]);
check(moved.tiles[0] !== box.tiles[0] && moved.owner === null && moved.opened === null, "the box stands on another tile, still sealed and nobody's");
box = moved;
await shot(a, "A2-placed");
await shot(b, "B2-sees-box");
const sealedForB = await b.evaluate(() => window.__tp.treasures.list()[0]);
check(sealedForB && sealedForB.contents === undefined, "B cannot read the sealed box");
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
check((await b.locator("#postcard .pc-flipper.pc-flipped").count()) === 1, "the finder sees the picture side first");
check((await b.textContent("#postcard .pc-cap")) === "the view from the hill", "the caption is on the picture");
await b.waitForFunction(() => document.querySelector("#postcard .pc-photo")?.naturalWidth > 0);
const finderPlaced = await b.evaluate(() => {
  const s = document.querySelector("#postcard .pc-photo").style;
  const f = document.querySelector("#postcard .pc-picture");
    const [left, top, width, height] = [s.left, s.top, s.width, s.height].map(parseFloat);
    // the point of the photo under the frame's centre: the crop, whatever the frame's size
    const focus = [(f.clientWidth / 2 - left) / width, (f.clientHeight / 2 - top) / height];
    return { left, top, width, frame: [f.clientWidth, f.clientHeight], focus };
});
// same zoom and the same point of the photo under the centre of the card; the phone's read card
// can be a pixel or two shorter than the compose card, so pixel offsets are compared through the focus
check(
  Math.abs(finderPlaced.width - senderPlaced.width) < 0.5 &&
    finderPlaced.focus.every((v, i) => Math.abs(v - senderPlaced.focus[i]) < 0.002) &&
    Math.abs(finderPlaced.focus[0] - 0.5) + Math.abs(finderPlaced.focus[1] - 0.5) > 0.005,
  `the finder sees the sender's crop, not the centred default (${JSON.stringify(finderPlaced)} vs ${JSON.stringify(senderPlaced)})`,
);
await shot(b, "B4a-picture-side");
await shot(a, "A4-lid-open");
await b.click("#postcard .pc-face-picture");
await b.waitForTimeout(700);
check((await b.locator("#postcard .pc-flipper.pc-flipped").count()) === 0, "a click on the card turns it to the writing");
await shot(b, "B4-postcard");
// a picture whose file is gone drops the picture side rather than showing a broken image
await b.evaluate(() => {
  const img = document.querySelector("#postcard .pc-photo");
  img.src = "/media/gone-" + Date.now() + ".jpg";
});
await b.waitForFunction(() => document.querySelector("#pc-turn")?.hidden === true);
check(
  await b.evaluate(
    () => document.querySelector("#pc-turn")?.hidden === true && document.querySelector("#postcard .pc-flipper.pc-flipped") === null,
  ),
  "a missing picture file hides the pill and keeps the writing face",
);
// the broken-image check destroyed the picture face: leave the box and open it again
await b.click("#pc-leave");
await b.waitForFunction(() => document.getElementById("postcard").hidden);
await b.waitForFunction(() => !document.getElementById("box-btn").hidden, { timeout: 5000 });
await b.click("#box-btn");
await b.waitForFunction(() => !document.getElementById("postcard").hidden, { timeout: 10000 });
check(
  (await b.locator("#postcard .pc-flipper.pc-flipped").count()) === 1 && !(await b.evaluate(() => document.querySelector("#pc-turn").hidden)),
  "reopened, the box shows its picture side again",
);
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
check(finalA.loc === "ger" && finalA.contents !== undefined, "A sees the placed box and still reads her own words");

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

// ---- Act 1b: a postcard with a picture taken inside the world --------------
// on the globe, for the sky; A turns her back on B so she walks away from the spawns
await a.evaluate(([from, away]) => {
  const tp = window.__tp;
  const w = tp.player.world;
  const far = w.tilePos(away, 0, tp.player.pos.clone());
  const dist = (n) => w.tilePos(n, 0, tp.player.pos.clone()).distanceTo(far);
  const back = w.neighbors(from).filter((n) => !w.isBlockedFor(n, "bee")).sort((x, y) => dist(y) - dist(x))[0];
  tp.lookAt(back);
}, [SPAWN_A, SPAWN_B]);
const tapOrClick = (p, sel) => (MOBILE ? p.tap(sel) : p.click(sel));
await a.click("#treasure-open");
await a.click("#treasure-leave");
await a.waitForSelector("#postcard textarea.pc-text");
await a.fill("#postcard textarea.pc-text", "Look at our sky tonight.");
await tapOrClick(a, "#pc-turn");
await tapOrClick(a, "#pc-snap");
await a.waitForSelector("body.photo #photo:not([hidden])");
check((await a.locator("#postcard.pc-away").count()) === 1, "the card steps aside while the viewfinder is up");
check((await a.isHidden("#chat-panel")) && (await a.isHidden("#treasure-open")), "the HUD hides in photo mode");
const rect = (p, sel) =>
  p.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
  }, sel);
const apart = (x, y) => x.r <= y.l || y.r <= x.l || x.b <= y.t || y.b <= x.t;
const win = await rect(a, "#ph-window");
const shutterBox = await rect(a, "#ph-shutter");
const vw = await a.evaluate(() => innerWidth);
check(Math.abs(win.w / win.h - 1.5) < 0.01, `the viewfinder window is 3:2 (${Math.round(win.w)}x${Math.round(win.h)})`);
check(
  (await a.locator("#ph-window .ph-corner").count()) === 4 && (await a.isVisible("#ph-hint")) && (await rect(a, "#ph-hint")).t > win.b,
  "four corner marks, and the hint sits under the window",
);
check(Math.abs(shutterBox.l + shutterBox.w / 2 - vw / 2) <= 1 && shutterBox.t > win.b, "the shutter sits centred at the bottom of the screen");
if (MOBILE) {
  check(await a.isVisible("#dpad"), "the d-pad stays up in photo mode");
  // the buttons, not the grid's box: the shutter sits in the d-pad's empty bottom-right cell
  const pads = await a.evaluate(() =>
    [...document.querySelectorAll("#dpad button")].map((e) => {
      const r = e.getBoundingClientRect();
      return { l: r.left, t: r.top, r: r.right, b: r.bottom };
    }),
  );
  const zoom = await rect(a, "#zoom-slider");
  check(
    pads.length === 5 &&
      pads.every((p) => apart(shutterBox, p) && apart(win, p)) &&
      apart(shutterBox, zoom) &&
      apart(win, zoom),
    "the shutter and the window clear the d-pad and the zoom slider",
  );
}
await shot(a, "D1-viewfinder");
const mid = { x: win.l + win.w / 2, y: win.t + win.h / 2 };
await a.mouse.move(mid.x, mid.y);
await a.mouse.down();
await a.mouse.move(mid.x, mid.y + 160, { steps: 10 }); // a drag down: the tilt stops at its lower limit (-0.26)
await a.mouse.up();
const lowTilt = await a.evaluate(() => window.__tp.look().tilt);
// at TILT_PER_PX 0.002, 205px turns 0.41 up (from the lower limit to 0.15 above level) and 145px
// turns 0.29 (to 0.03): the phone's window spans far fewer degrees, so a smaller tilt keeps the
// character inside it
const up = MOBILE ? 145 : 205;
await a.mouse.move(mid.x, mid.y);
await a.mouse.down();
await a.mouse.move(mid.x, mid.y - up, { steps: 10 });
await a.mouse.up();
const upTilt = await a.evaluate(() => window.__tp.look().tilt);
check(lowTilt < 0 && upTilt > 0, `dragging up tilts the view up (tilt ${lowTilt.toFixed(2)} -> ${upTilt.toFixed(2)})`);
// walking works as usual while the viewfinder is up
const startTile = await a.evaluate(() => window.__tp.player.tile);
await a.keyboard.down("KeyW");
await a.waitForTimeout(700);
await a.keyboard.up("KeyW");
await a.waitForFunction(() => !window.__tp.player.moving, { timeout: 5000 });
await a.waitForTimeout(300);
const standTile = await a.evaluate(() => window.__tp.player.tile);
check(standTile !== startTile, "W walks the character in photo mode");
await shot(a, "D2-aimed-at-the-sky");
// two presses in one go must take a single shot
await a.evaluate(() => {
  window.__shots = 0;
  const toBlob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function (...args) {
    window.__shots++;
    return toBlob.apply(this, args);
  };
  const s = document.getElementById("ph-shutter");
  s.click();
  s.click();
  window.__restoreToBlob = () => (HTMLCanvasElement.prototype.toBlob = toBlob);
});
await a.waitForSelector("#postcard:not(.pc-away)");
await a.waitForFunction(() => document.querySelector("#postcard .pc-photo")?.naturalWidth > 0);
check((await a.evaluate(() => window.__shots)) === 1, "a second shutter press does not take a second shot");
await a.evaluate(() => window.__restoreToBlob());
check((await a.locator("#postcard .pc-photo").count()) === 1, "the shot is staged on the picture face");
check((await a.locator("#postcard .pc-flipper.pc-flipped").count()) === 1, "the card comes back on the picture side");
check((await a.locator("body.photo").count()) === 0, "photo mode is over");
await a.evaluate(() => document.fonts.ready);
await shot(a, "D3-shot-staged");
const shotSrc = await a.evaluate(() => document.querySelector("#postcard .pc-photo").src);
await tapOrClick(a, "#pc-retake");
await a.waitForSelector("body.photo");
await a.keyboard.press("Escape");
await a.waitForSelector("#postcard:not(.pc-away)");
check(
  (await a.locator("#postcard .pc-photo").count()) === 1 &&
    (await a.evaluate(() => document.querySelector("#postcard .pc-photo").src)) === shotSrc &&
    !(await a.isHidden("#postcard")) &&
    (await a.locator("body.photo").count()) === 0,
  "Escape leaves photo mode with the card open and the old shot untouched",
);
await tapOrClick(a, '#postcard [data-size="s"]');
await tapOrClick(a, "#pc-send");
await a.waitForFunction(() => document.getElementById("postcard").hidden, { timeout: 20000 });
await a.waitForFunction(
  () => window.__tp.treasures.list().some((x) => x.contents?.writing?.text === "Look at our sky tonight." && x.loc !== null),
  { timeout: 5000 },
);
const skyBox = (await a.evaluate(() => window.__tp.treasures.list())).find((x) => x.contents?.writing?.text === "Look at our sky tonight.");
check(skyBox.contents.picture?.image.url.startsWith("/media/") === true, "the shot was uploaded and the box carries it");
check(
  await a.evaluate(([stand, tile]) => window.__tp.player.world.neighbors(stand).includes(tile), [standTile, skyBox.tiles[0]]),
  "the box stands in front of where A was when she pressed Leave it here",
);
// B finds it: the shot is the picture side
await approach(b, skyBox.tiles[0], standTile);
await readOpen(b);
await b.waitForFunction(() => document.querySelector("#postcard .pc-photo")?.naturalWidth > 0);
check(
  (await b.locator("#postcard .pc-flipper.pc-flipped").count()) === 1 &&
    (await b.evaluate(() => document.querySelector("#postcard .pc-photo").src.includes("/media/"))),
  "the finder sees the shot on the picture side",
);
await shot(b, "D4-shot-read");
await keep(b);
await home(a, SPAWN_A, SPAWN_B);
await a.waitForTimeout(400);

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
const note = await a.evaluate(() => window.__tp.treasures.list().find((x) => x.contents?.style === "note"));
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
const photos = await a.evaluate(() => window.__tp.treasures.list().find((x) => x.contents?.style === "media"));
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
const oops = await a.evaluate(() => window.__tp.treasures.list().find((x) => x.contents?.style === "postcard" && x.contents.writing.text === "Oops, wrong spot."));
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
check(
  !(await a.evaluate((id) => window.__tp.treasures.list().some((x) => x.id === id), oops.id)) &&
    !(await b.evaluate((id) => window.__tp.treasures.list().some((x) => x.id === id), oops.id)),
  "the taken-back box vanished for both players",
);
await shot(a, "C6-taken-back");

await browser.close();
console.log(process.exitCode ? "DRIVE FAILED" : "done - screenshots in /tmp/tinyplanet-treasure-*.png");
