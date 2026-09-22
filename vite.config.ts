import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/ws": { target: "ws://localhost:3001", ws: true },
      "/media": { target: "http://localhost:3001" },
    },
  },
});
