// Visual check for building owners, the sign, knocking and letting in.
// gloria (A) claims the crooked house b3 through its sign; khurlee (B) sees
// Knock, knocks, and A lets him in from the doorstep; B goes in, steps out and
// must knock again; A opens it to both while B waits and B walks in freely.
// Then the Hive: B knocks, A lets him in from inside on the exit tile, B
// reloads inside and is put back on the doorstep. Signs at both treasure
// houses, a pennant in each colour, and the camera fading the building a
// player steps out of (the Hive, the Copper Hall, the opera house).
// Screenshots land in /tmp/haven-houses-t6-*.png.
// Run against a FRESH database so nothing is owned yet:
//   rm -f /tmp/tp-t6.db; DB_PATH=/tmp/tp-t6.db PLANET_PASS=planet npm run dev
//   node scripts/drive-doors.mjs
// MOBILE=1 drives a 390x844 touch phone instead of a 1280x800 desktop.
import { chromium } from "playwright-core";
import { headlessShell } from "./_browser.mjs";

const URL = process.argv[2] ?? "http://localhost:5173";
const MOBILE = process.env.MOBILE === "1";
const tag = MOBILE ? "phone" : "desktop";
const shot = (page, name) => page.screenshot({ path: `/tmp/haven-houses-t6-${tag}-${name}.png` });
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

const owners = (p) => p.evaluate(() => window.__tp.ownership().owners);
check(!("b3" in (await owners(a))), "fresh database: b3 is open to both (delete /tmp/tp-t6.db and restart if this fails)");
if (process.exitCode) {
  await browser.close();
  process.exit(1);
}

const building = (p, id) => p.evaluate((i) => window.__tp.buildings.find((x) => x.id === i), id);
const b3 = await building(a, "b3");
const hive = await building(a, "hive");
const hall = await building(a, "hall");
const b4 = await building(a, "b4");
const opera = await building(a, "opera");

/** Stands `p` on building `bd`'s doorstep facing it. */
async function toDoor(p, bd) {
  await p.evaluate((d) => {
    window.__tp.teleport(d.doorTiles[0]);
    window.__tp.lookAt(d.tiles[0]);
  }, bd);
  await p.waitForTimeout(400);
}
/** Moves `p` well away from the doorstep (the tile beside it, off to one side). */
async function stepAside(p, bd) {
  await p.evaluate((d) => {
    const n = window.__tp.neighbors(d.doorTiles[0]).find((t) => t >= 0 && !d.tiles.includes(t) && window.__tp.walkable(t));
    window.__tp.teleport(n);
  }, bd);
  await p.waitForTimeout(300);
}
// labels keep the door emoji on the last word with a no-break space; compare them as plain text
const text = (p, sel) => p.evaluate((s) => (document.querySelector(s)?.textContent ?? "").replaceAll("\u00a0", " "), sel);
const visible = (p, sel) => p.evaluate((s) => !document.querySelector(s)?.hidden, sel);
const loc = (p) => p.evaluate(() => window.__tp.debug().loc);
const waitToast = async (p, want) => {
  await p.waitForFunction((w) => !document.getElementById("toast").hidden && document.getElementById("toast").textContent === w, want, { timeout: 5000 }).catch(() => {});
  return text(p, "#toast");
};
const waitEnter = async (p, want) => {
  await p.waitForFunction((w) => document.getElementById("enter").textContent.replaceAll("\u00a0", " ") === w, want, { timeout: 5000 }).catch(() => {});
  return text(p, "#enter");
};

// ---- A claims the crooked house through its sign -----------------------------
await toDoor(a, b3);
check((await text(a, "#enter")) === "Enter the crooked house 🚪 (E)", "A: an open house reads Enter the crooked house");
check(await visible(a, "#sign-btn"), "A: the Sign button shows on the doorstep");
await shot(a, "01-doorstep-open");
check(
  (await a.evaluate(() => getComputedStyle(document.querySelector("#enter .key-hint")).display)) === (MOBILE ? "none" : "inline"),
  MOBILE ? "A: no (E) hint on a phone" : "A: the (E) hint shows on a keyboard",
);
await a.click("#sign-btn");
check((await text(a, "#sign-text")) === "The crooked house is open to both.", "A: the sign says open to both");
check((await text(a, "#sign-action")) === "Make it mine", "A: the sign offers Make it mine");
check(!(await visible(a, "#enter")), "A: the action stack steps aside while the sign is open");
await shot(a, "02-sign-open");
await a.click("#sign-action");
await a.waitForFunction(() => window.__tp.ownership().owners.b3 === 0, null, { timeout: 5000 });
check((await text(a, "#sign-text")) === "The crooked house is yours.", "A: the sign now says yours");
check((await text(a, "#sign-action")) === "Open it to both", "A: the sign offers Open it to both");
await shot(a, "03-sign-yours");
if (MOBILE) await a.click("#sign-close");
else await a.keyboard.press("Escape");
check(!(await visible(a, "#sign")), "A: the sign closes");
check((await text(a, "#enter")) === "Enter your crooked house 🚪 (E)", "A: Enter your crooked house");
check((await a.evaluate(() => window.__tp.pennants().b3)) === 0, "A: a gold pennant flies at b3");
await b.waitForFunction(() => window.__tp.ownership().owners.b3 === 0, null, { timeout: 5000 });
check((await b.evaluate(() => window.__tp.pennants().b3)) === 0, "B: sees the gold pennant too");

// A walks off; the pennant from a little way back
await stepAside(a, b3);
await a.evaluate((d) => window.__tp.lookAt(d.tiles[0]), b3);
await a.waitForTimeout(400);
await shot(a, "04-pennant-gold");

// ---- B knocks -------------------------------------------------------------
await toDoor(b, b3);
check((await text(b, "#enter")) === "Knock at gloria's crooked house 🚪 (E)", "B: Knock at gloria's crooked house");
await b.click("#sign-btn");
check(
  (await text(b, "#sign-text")) === "The crooked house is gloria's. Knock and she can let you in.",
  "B: the sign says it is gloria's",
);
check(!(await visible(b, "#sign-action")), "B: no button on the partner's sign");
await shot(b, "05-sign-partner");
await b.click("#sign-close");
await b.click("#enter");
check((await loc(b)) === "globe", "B: knocking does not open the door");
check((await waitToast(b, "You knocked. gloria will come to the door.")) === "You knocked. gloria will come to the door.", "B: You knocked toast");
check((await waitToast(a, "khurlee is knocking at your crooked house")) === "khurlee is knocking at your crooked house", "A: gets the knock toast wherever she is");
await shot(b, "06-knocked");
await shot(a, "07-knock-toast");

// ---- A lets him in from the doorstep --------------------------------------
await stepAside(b, b3);
await toDoor(a, b3);
check((await text(a, "#let-in")) === "Let khurlee in (E)", "A: Let khurlee in (E) on the doorstep");
check((await text(a, "#enter")) === "Enter your crooked house 🚪", "A: the Enter button gives up its (E)");
await shot(a, "08-let-in-outside");
await a.evaluate(() => {
  // count door-open requests: a double tap must send only one
  const send = WebSocket.prototype.send;
  window.__opens = 0;
  WebSocket.prototype.send = function (data) {
    if (String(data).includes('"door-open"')) window.__opens++;
    return send.call(this, data);
  };
});
if (MOBILE) await a.evaluate(() => { const btn = document.getElementById("let-in"); btn.click(); btn.click(); });
else {
  await a.keyboard.press("KeyE"); // E fires the first button: the let-in
  await a.evaluate(() => document.getElementById("let-in").click()); // and a stray click right after
}
const opens = await a.evaluate(() => window.__opens);
check(opens === 1, "A: a double press sends one door-open");
check((await waitToast(b, "gloria opened the door")) === "gloria opened the door", "B: gloria opened the door");
check((await loc(a)) === "globe", "A: E let him in rather than walking in herself");
await a.waitForFunction(() => document.getElementById("let-in").hidden, null, { timeout: 5000 });
check((await text(a, "#enter")) === "Enter your crooked house 🚪 (E)", "A: the Enter button takes (E) back");
await a.click("#enter"); // A goes in herself, freeing the doorstep
await a.waitForTimeout(300);
await toDoor(b, b3);
check((await text(b, "#enter")) === "Enter gloria's crooked house 🚪 (E)", "B: Enter gloria's crooked house after the grant");
await b.click("#enter");
check((await loc(b)) === "b3", "B: went in");
await b.waitForTimeout(500); // the server sees him inside
await b.evaluate(() => window.__tp.leaveBuilding());
await b.waitForFunction(() => window.__tp.ownership().grants.length === 0, null, { timeout: 5000 });
check((await waitEnter(b, "Knock at gloria's crooked house 🚪 (E)")) === "Knock at gloria's crooked house 🚪 (E)", "B: stepped out, and must knock again");

// ---- B knocks, then A opens the house to both while he waits --------------
await b.click("#enter");
await waitToast(a, "khurlee is knocking at your crooked house");
await stepAside(b, b3);
await a.evaluate(() => window.__tp.leaveBuilding());
await a.waitForTimeout(300);
check((await text(a, "#let-in")) === "Let khurlee in (E)", "A: the renewed knock shows Let khurlee in");
await a.click("#sign-btn");
await a.click("#sign-action");
await a.waitForFunction(() => !("b3" in window.__tp.ownership().owners), null, { timeout: 5000 });
check((await text(a, "#sign-text")) === "The crooked house is open to both.", "A: the sign reads open to both again");
check((await waitToast(b, "The crooked house is open to both now")) === "The crooked house is open to both now", "B: The crooked house is open to both now");
check((await b.evaluate(() => window.__tp.pennants().b3)) === undefined, "B: the pennant came down");
await a.click("#sign-close");
check(await a.evaluate(() => document.getElementById("let-in").hidden), "A: the dropped knock takes the let-in with it");
await stepAside(a, b3);
await toDoor(b, b3);
check((await text(b, "#enter")) === "Enter the crooked house 🚪 (E)", "B: Enter the crooked house");
await b.click("#enter");
check((await loc(b)) === "b3", "B: walked in freely");
await b.evaluate(() => window.__tp.leaveBuilding());

// ---- khurlee claims the mushroom house b4: a green pennant ----------------
await toDoor(b, b4);
await b.click("#sign-btn");
await b.click("#sign-action");
await b.waitForFunction(() => window.__tp.ownership().owners.b4 === 1, null, { timeout: 5000 });
await b.click("#sign-close");
await stepAside(b, b4);
await b.evaluate((d) => window.__tp.lookAt(d.tiles[0]), b4);
await b.waitForTimeout(400);
check((await b.evaluate(() => window.__tp.pennants().b4)) === 1, "B: a green pennant flies at b4");
await shot(b, "09-pennant-green");

// ---- the treasure houses' signs -------------------------------------------
await toDoor(a, hall);
check((await text(a, "#enter")) === "Knock at khurlee's Copper Hall 🚪 (E)", "A: Knock at khurlee's Copper Hall");
await a.click("#sign-btn");
check((await text(a, "#sign-text")) === "This is khurlee's Copper Hall.", "A: This is khurlee's Copper Hall.");
check(!(await visible(a, "#sign-action")), "A: no button on a treasure house sign");
await shot(a, "10-sign-hall-partner");
await a.click("#sign-close");
await stepAside(a, hall);
await toDoor(b, hall);
check((await text(b, "#enter")) === "Enter your Copper Hall 🚪 (E)", "B: Enter your Copper Hall");
await b.click("#sign-btn");
check((await text(b, "#sign-text")) === "This is your Copper Hall.", "B: This is your Copper Hall.");
await shot(b, "11-sign-hall-mine");
await b.click("#sign-close");
await stepAside(b, hall);
await b.evaluate((d) => window.__tp.lookAt(d.tiles[0]), hall);
await b.waitForTimeout(400);
await shot(b, "12-pennant-hall");

// ---- the Hive: khurlee knocks, gloria lets him in from inside -------------
await a.evaluate((id) => window.__tp.enterBuilding(window.__tp.buildings.find((x) => x.id === id)), "hive");
await a.waitForTimeout(400);
check((await text(a, "#enter")) === "Go back outside 🚪 (E)", "A: inside the Hive on the exit tile");
await toDoor(b, hive);
check((await text(b, "#enter")) === "Knock at gloria's Hive 🚪 (E)", "B: Knock at gloria's Hive");
await b.click("#sign-btn");
check((await text(b, "#sign-text")) === "This is gloria's Hive.", "B: This is gloria's Hive.");
await shot(b, "13-sign-hive-partner");
await b.click("#sign-close");
await b.click("#enter");
check((await waitToast(a, "khurlee is knocking at your Hive")) === "khurlee is knocking at your Hive", "A: khurlee is knocking at your Hive");
check((await text(a, "#let-in")) === "Let khurlee in (E)", "A: Let khurlee in (E) inside, on the exit tile");
check((await text(a, "#enter")) === "Go back outside 🚪", "A: Go back outside gives up its (E)");
await shot(a, "14-let-in-inside");
await a.click("#let-in");
check((await waitToast(b, "gloria opened the door")) === "gloria opened the door", "B: gloria opened the door (Hive)");
check((await waitEnter(b, "Enter gloria's Hive 🚪 (E)")) === "Enter gloria's Hive 🚪 (E)", "B: Enter gloria's Hive");
// A walks off the exit tile so B does not land on her
await a.evaluate(() => window.__tp.player.enterWorld(window.__tp.player.world, window.__tp.player.world.exitTile - 1, window.__tp.player.forward.clone()));
await b.click("#enter");
check((await loc(b)) === "hive", "B: inside the Hive");
await b.waitForTimeout(2600); // let the server persist his position inside
await shot(b, "15-inside-hive");

// ---- B reloads inside: the grant ended with his disconnect ---------------
await b.reload();
await b.waitForFunction(() => window.__tp?.joined(), { timeout: 20000 });
await b.waitForTimeout(800);
check((await loc(b)) === "globe", "B: logging in inside the Hive puts him outside");
check((await b.evaluate(() => window.__tp.debug().tile)) === hive.doorTiles[0], "B: on the Hive's doorstep");
check((await text(b, "#enter")) === "Knock at gloria's Hive 🚪 (E)", "B: and he must knock again");
// the tall Hive fills his view: it fades out completely rather than hanging over the screen as a haze
await b.waitForFunction(() => window.__tp.fade().hive === 0, null, { timeout: 5000 }).catch(() => {});
check((await b.evaluate(() => window.__tp.fade())).hive === 0, "B: the Hive behind him fades out so he can be seen");
check(await b.evaluate(() => window.__tp.buildingVisible("hive") === false), "B: the faded-out Hive is not drawn at all");
await shot(b, "16-restored-doorstep");

// ---- the camera: a building behind a player who steps out of it fades ------
await stepAside(b, hive);
// the tall treasure houses fill the view behind her and fade out completely (nothing drawn);
// the low opera house stays a see-through silhouette
for (const [bd, want] of [[hive, 0], [hall, 0], [opera, 0.35]]) {
  await a.evaluate((id) => window.__tp.enterBuilding(window.__tp.buildings.find((x) => x.id === id)), bd.id);
  await a.waitForTimeout(300);
  await a.evaluate(() => window.__tp.leaveBuilding());
  await a.waitForFunction(([id, w]) => window.__tp.fade()[id] === w, [bd.id, want], { timeout: 5000 }).catch(() => {});
  check(
    (await a.evaluate(() => window.__tp.fade()))[bd.id] === want,
    `A: stepping out of the ${bd.id}, it fades ${want ? "to a silhouette" : "out"} behind her`,
  );
  check(
    await a.evaluate(([id, w]) => window.__tp.buildingVisible(id) === w > 0, [bd.id, want]),
    `A: the faded ${bd.id} is ${want ? "still" : "not"} drawn`,
  );
  await shot(a, `17-camera-${bd.id}`);
  await a.evaluate((d) => window.__tp.lookAt(d.tiles[0]), bd);
  await a.waitForFunction((id) => !(id in window.__tp.fade()), bd.id, { timeout: 5000 }).catch(() => {});
  check(!(bd.id in (await a.evaluate(() => window.__tp.fade()))), `A: turned to face the ${bd.id}, it is solid again`);
  check(await a.evaluate((id) => window.__tp.buildingVisible(id) === true, bd.id), `A: and drawn again`);
  await shot(a, `18-camera-${bd.id}-solid`);
}

// ---- a small house between the camera and the character: a see-through silhouette
await a.evaluate((d) => {
  const tp = window.__tp;
  const bt = d.tiles[0];
  // the tile behind the house, seen from its door, with her back to the house
  const back = tp.neighbors(bt).find((t) => t !== d.doorTiles[0] && !tp.neighbors(d.doorTiles[0]).includes(t));
  tp.teleport(back);
  tp.lookAt(bt);
  tp.player.enterWorld(tp.player.world, back, tp.player.forward.clone().negate());
}, b3);
await a.waitForFunction(() => window.__tp.fade().b3 === 0.35, null, { timeout: 5000 }).catch(() => {});
check((await a.evaluate(() => window.__tp.fade())).b3 === 0.35, "A: a house between the camera and her fades to a silhouette");
check(await a.evaluate(() => window.__tp.buildingVisible("b3") === true), "A: the silhouette is still drawn");
await shot(a, "19-camera-silhouette");

await browser.close();
console.log(process.exitCode ? "DOORS FAILED" : "DOORS PASSED");
