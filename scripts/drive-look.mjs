// Looking around: dragging the world swings the camera around the character
// and tilts it, the character stays put, walking during a drag goes where the
// character faces, a plain click turns nothing, and letting go eases the view
// back behind the character. MOBILE=1 drags with a finger on a phone.
// Screenshots land in /tmp/haven-look-*.png.
//   DB_PATH=/tmp/tp-drive.db PLANET_PASS=planet npm run dev
//   node scripts/drive-look.mjs
import { chromium } from "playwright-core";
import { headlessShell } from "./_browser.mjs";

const URL = process.argv[2] ?? "http://localhost:5173";
const MOBILE = process.env.MOBILE === "1";
const check = (cond, what) => {
  if (!cond) {
    console.error(`FAIL: ${what}`);
    process.exitCode = 1;
  } else console.log(`  ok: ${what}`);
};

const browser = await chromium.launch({ executablePath: headlessShell(), args: ["--no-sandbox"] });
const ctx = await browser.newContext(
  MOBILE ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 800 } },
);
await ctx.addInitScript(() => localStorage.setItem("tp-auth", JSON.stringify({ id: 1, pass: "planet" })));
const p = await ctx.newPage();
p.on("pageerror", (e) => console.log(`pageerror: ${e.message}`));
await p.goto(URL);
await p.waitForFunction(() => window.__tp?.joined(), { timeout: 20000 });
await p.waitForTimeout(800);
const shot = (name) => p.screenshot({ path: `/tmp/haven-look-${name}.png` });
const cdp = MOBILE ? await ctx.newCDPSession(p) : null;
const [cx, cy] = MOBILE ? [260, 330] : [640, 330]; // open sky and grass, clear of every button and the d-pad

/** Presses at the centre, moves by (dx, dy) in steps and keeps holding. */
async function press(dx, dy) {
  if (MOBILE) {
    const at = (x, y) => [{ x, y, id: 1 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(cx, cy) });
    for (let i = 1; i <= 10; i++)
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(cx + (dx * i) / 10, cy + (dy * i) / 10) });
  } else {
    await p.mouse.move(cx, cy);
    await p.mouse.down();
    await p.mouse.move(cx + dx, cy + dy, { steps: 10 });
  }
}
async function release() {
  if (MOBILE) await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  else await p.mouse.up();
}
const state = () =>
  p.evaluate(() => {
    const tp = window.__tp;
    return { look: tp.look(), turned: tp.turned(), tile: tp.player.tile, fwd: tp.player.forward.toArray() };
  });

const before = await state();
await shot("0-usual");

// a plain click or tap turns nothing
if (MOBILE) await p.touchscreen.tap(cx, cy);
else await p.mouse.click(cx, cy);
await p.waitForTimeout(200);
check((await state()).look.yaw === 0, "a plain click turns nothing");

// drag left: the view swings round to the character's side, the character stays put
await press(-300, 0);
await p.waitForTimeout(900);
let s = await state();
check(Math.abs(s.look.yaw - 1.2) < 0.01 && s.turned > 1, `dragging left swings the view round (yaw ${s.look.yaw.toFixed(2)})`);
check(await p.evaluate(() => document.body.classList.contains("looking")), "the page knows a look is on (grabbing cursor)");
check(s.tile === before.tile && s.fwd.every((v, i) => Math.abs(v - before.fwd[i]) < 1e-6), "the character did not move or turn");
await shot("1-side");

// walking during the look goes where the character faces, not where the camera looks
const ahead = await p.evaluate(() => {
  const tp = window.__tp;
  return tp.player.world.neighborInDirection(tp.player.tile, tp.player.forward);
});
await p.keyboard.down("KeyW");
await p.waitForFunction((t) => window.__tp.player.tile === t, ahead, { timeout: 3000 }).catch(() => {});
await p.keyboard.up("KeyW");
await p.waitForTimeout(400);
s = await state();
check(s.tile === ahead, "W during a look walks the character straight ahead");
check(Math.abs(s.look.yaw - 1.2) < 0.01, "the view stays turned while held");
await release();
await p.waitForTimeout(1200);
s = await state();
check(s.look.yaw === 0 && s.look.tilt === 0 && Math.abs(s.turned) < 0.02, "letting go eases the view back behind the character");
check(!(await p.evaluate(() => document.body.classList.contains("looking"))), "the look is over");
await shot("2-back");

// up to the sky, down to the ground
await press(0, -300);
await p.waitForTimeout(900);
check((await state()).look.tilt > 0.5, "dragging up looks up");
await shot("3-up");
await release();
await p.waitForTimeout(900);
await press(0, 400);
await p.waitForTimeout(900);
check(Math.abs((await state()).look.tilt + 0.35) < 1e-6, "dragging down looks down, as far as the ground at the feet");
await shot("4-down");
await release();
await p.waitForTimeout(900);
check((await state()).look.tilt === 0, "and back again");

await browser.close();
console.log("done - screenshots in /tmp/haven-look-*.png");
