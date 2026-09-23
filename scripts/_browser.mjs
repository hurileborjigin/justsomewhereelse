// The Playwright headless-shell binary changes folder name with every
// playwright-core release; find whatever is installed instead of hardcoding.
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function headlessShell() {
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  const dirs = readdirSync(cache)
    .filter((d) => d.startsWith("chromium_headless_shell-"))
    .sort();
  if (dirs.length === 0) {
    throw new Error(`no chromium_headless_shell in ${cache}; run: npx playwright-core install chromium-headless-shell`);
  }
  return join(cache, dirs.at(-1), "chrome-headless-shell-mac-arm64/chrome-headless-shell");
}
