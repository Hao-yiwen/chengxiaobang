import { defineConfig } from "tsup";

const external = ["electron", "node-pty", "pino"];

export default defineConfig([
  {
    name: "main",
    entry: ["src/main/main.ts"],
    format: "esm",
    platform: "node",
    external,
    outDir: "dist/main",
    clean: ["dist/main", "dist/main.js"]
  },
  {
    name: "preload",
    entry: ["src/preload/index.ts"],
    format: "cjs",
    platform: "node",
    external,
    outDir: "dist/preload",
    outExtension: () => ({ js: ".cjs" }),
    clean: ["dist/preload"]
  }
]);
