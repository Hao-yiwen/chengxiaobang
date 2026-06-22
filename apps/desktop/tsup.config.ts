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
    // @chengxiaobang/shared 是 workspace 包,打包产物里不保证可解析,
    // 必须内联进 main 包(tsup 默认会把 dependencies 外置)。
    noExternal: ["@chengxiaobang/shared"],
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
