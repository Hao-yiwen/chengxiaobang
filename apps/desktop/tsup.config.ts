import { fileURLToPath } from "node:url";
import { defineConfig } from "tsup";

// 把 shared 的轻量子路径解析到源码,而不是 dist。
// 这样 fresh checkout(未先 build shared)下 desktop 自己的 build 也能成功;
// 这些文件无外部依赖,内联进 main 包不会带入 zod 等。
const sharedErrorSource = fileURLToPath(
  new URL("../../packages/shared/src/error.ts", import.meta.url)
);
const sharedProductSource = fileURLToPath(
  new URL("../../packages/shared/src/product.ts", import.meta.url)
);

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
    // tsup 默认把 dependencies 外置;关掉 shared 的外置,再用 alias 把轻量子路径解析到源码,
    // 从而内联进 main 包且不依赖 packages/shared/dist。
    noExternal: ["@chengxiaobang/shared"],
    esbuildOptions(options) {
      options.alias = {
        ...options.alias,
        "@chengxiaobang/shared/error": sharedErrorSource,
        "@chengxiaobang/shared/product": sharedProductSource
      };
    },
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
