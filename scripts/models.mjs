// Regenerates every .glb in public/models/ by running Blender headlessly over
// the scripts in assets/blender/ (plus any hand-made .blend files in
// assets/blender/blends/). Usage: npm run models
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BLENDER = process.env.BLENDER ?? "/Applications/Blender.app/Contents/MacOS/Blender";
const srcDir = join(root, "assets", "blender");
const blendDir = join(srcDir, "blends");
const outDir = join(root, "public", "models");
mkdirSync(outDir, { recursive: true });

if (!existsSync(BLENDER)) {
  console.error(`Blender not found at ${BLENDER} - set the BLENDER env var to your binary.`);
  process.exit(1);
}

function run(args, label) {
  const res = spawnSync(
    BLENDER,
    ["--background", "--factory-startup", "--python-exit-code", "1", ...args],
    { encoding: "utf8" },
  );
  const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
  for (const line of out.split("\n")) {
    if (/exported |Error|Traceback|  File "/.test(line)) console.log(`  ${line.trim()}`);
  }
  if (res.status !== 0) {
    console.error(out);
    console.error(`x ${label} failed (exit ${res.status})`);
    process.exit(1);
  }
}

const scripts = readdirSync(srcDir)
  .filter((f) => f.endsWith(".py") && !f.startsWith("_"))
  .sort();
for (const script of scripts) {
  console.log(`> ${script}`);
  run(["--python", join(srcDir, script), "--", "--out", outDir], script);
}

if (existsSync(blendDir)) {
  const blends = readdirSync(blendDir)
    .filter((f) => f.endsWith(".blend"))
    .sort();
  for (const blend of blends) {
    console.log(`> blends/${blend}`);
    run(
      [join(blendDir, blend), "--python", join(root, "scripts", "export_blend.py"), "--", "--out", outDir],
      blend,
    );
  }
}

console.log("all models exported.");
