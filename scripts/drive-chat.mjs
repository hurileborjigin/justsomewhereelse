// Visual check for the chat feature: two headless players, A chats while B has
// the panel minimized (badge check), B replies, both screenshot.
// Usage: node scripts/drive-chat.mjs [url]
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
  await page.waitForFunction(() => !document.getElementById("loading"), { timeout: 15000 });
  return page;
}

const a = await openPlayer("A");
const b = await openPlayer("B");
await a.waitForTimeout(1200);

// B walks two steps to the side so both characters are in each other's view.
// The chat panel starts minimized, which is what the unread badge check needs.
await b.keyboard.down("a");
await b.waitForTimeout(1100);
await b.keyboard.up("a");

// A types while holding nothing - also proves WASD is ignored while typing
await a.click("#chat-input");
await a.keyboard.type("hi my love! wwww should not move me 🐝");
await a.keyboard.press("Enter");
await a.waitForTimeout(700);

await a.screenshot({ path: "/tmp/haven-chat-A1.png" });
await b.screenshot({ path: "/tmp/haven-chat-B1.png" });

const badge = await b.evaluate(() => ({
  badgeHidden: document.getElementById("chat-badge")?.hidden,
  badgeText: document.getElementById("chat-badge")?.textContent,
  panelHidden: document.getElementById("chat-panel")?.hidden,
}));
console.log("B badge state (panel minimized):", badge);

// B reopens the panel and replies via Enter-to-focus
await b.click("#chat-open");
await b.keyboard.press("Enter");
await b.keyboard.type("found you already 🫏");
await b.keyboard.press("Enter");
await b.waitForTimeout(700);

await a.screenshot({ path: "/tmp/haven-chat-A2.png" });
await b.screenshot({ path: "/tmp/haven-chat-B2.png" });

const logA = await a.evaluate(() =>
  [...document.querySelectorAll("#chat-log .msg")].map((m) => m.className + ": " + m.textContent),
);
const logB = await b.evaluate(() =>
  [...document.querySelectorAll("#chat-log .msg")].map((m) => m.className + ": " + m.textContent),
);
console.log("A history:", logA);
console.log("B history:", logB);

await browser.close();
console.log("done - screenshots in /tmp/haven-chat-*.png");
