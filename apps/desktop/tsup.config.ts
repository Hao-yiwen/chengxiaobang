import { defineConfig } from "tsup";

const external = [
  "@napi-rs/canvas",
  "electron",
  "electron-updater",
  "node-pty",
  "onnxruntime-node",
  "pino",
  "ppu-ocv",
  "ppu-paddle-ocr",
  "sharp"
];

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
