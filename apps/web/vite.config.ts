import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    target: "es2022",
    rollupOptions: {
      input: { index: resolve(__dirname, "index.html"), play: resolve(__dirname, "play.html"), verify: resolve(__dirname, "verify.html"), agents: resolve(__dirname, "agents.html"), tree: resolve(__dirname, "tree.html"), numbers: resolve(__dirname, "numbers.html"), handheld: resolve(__dirname, "handheld.html") },
    },
  },
  server: { port: 5199 },
});
