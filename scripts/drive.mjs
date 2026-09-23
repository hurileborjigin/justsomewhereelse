// Dev-only visual driver: opens TWO headless browsers against the dev server,
// walks player A around, and saves screenshots to /tmp/tinyplanet-*.png so a
// human (or agent) can eyeball movement, camera and multiplayer sync.
// Usage: node scripts/drive.mjs [url]
import { chromium } from "playwright-core";
import { headlessShell } from "./_browser.mjs";

const URL = process.argv[2] ?? "http://localhost:5173";

const browser = await chromium.launch({ executablePath: headlessShell(), args: ["--no-sandbox"] });

async function openPlayer(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((id) => localStorage.setItem("tp-auth", JSON.stringify({ id, pass: "planet" })), name === "A" ? 0 : 1);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`[${name}] pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`[${name}] console.error: ${m.text()}`);
  });
  await page.goto(URL);
  await page.waitForFunction(() => window.__tp?.joined(), { timeout: 15000 });
  await page.waitForFunction(() => !document.getElementById("loading"), { timeout: 15000 });
  return page;
}

const a = await openPlayer("A");
const b = await openPlayer("B");
await a.waitForTimeout(1500);

const hud = async (p) =>
  p.evaluate(() => ({
    status: document.getElementById("status-text")?.textContent,
  }));
console.log("A hud:", await hud(a));
console.log("B hud:", await hud(b));

await a.screenshot({ path: "/tmp/tinyplanet-A0.png" });
await b.screenshot({ path: "/tmp/tinyplanet-B0.png" });

// A walks forward for ~2.5s (about 5 tiles), then turns right for ~1.5s
await a.keyboard.down("w");
await a.waitForTimeout(2500);
await a.keyboard.up("w");
await a.waitForTimeout(400);
await a.screenshot({ path: "/tmp/tinyplanet-A1.png" });
await b.screenshot({ path: "/tmp/tinyplanet-B1.png" });

await a.keyboard.down("d");
await a.waitForTimeout(1600);
await a.keyboard.up("d");
await a.waitForTimeout(600);
await a.screenshot({ path: "/tmp/tinyplanet-A2.png" });
await b.screenshot({ path: "/tmp/tinyplanet-B2.png" });

await browser.close();
console.log("done - screenshots in /tmp/tinyplanet-*.png");
