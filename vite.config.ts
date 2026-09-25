import { mkdirSync, writeFileSync } from "node:fs";
import { defineConfig } from "vite";

// One id per build, baked into the bundle and written next to it, so the
// server can tell a tab that runs an older bundle to reload (main.ts).
const BUILD_ID = process.env.BUILD_ID ?? Date.now().toString(36);

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [
    {
      name: "build-id",
      apply: "build",
      closeBundle() {
        mkdirSync("dist", { recursive: true });
        writeFileSync("dist/build-id", BUILD_ID);
      },
    },
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/ws": { target: "ws://localhost:3001", ws: true },
      "/media": { target: "http://localhost:3001" },
      "/spotify": { target: "http://localhost:3001" },
    },
  },
});
