import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  platform: "node",
  dts: true,
  outDir: "dist",
  noExternal: [
    "sql.js",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-agent-core",
    "pptxgenjs",
    "docx",
    "exceljs",
    "@larksuiteoapi/node-sdk"
  ],
  // Optional native peers of ws (pulled in via the lark SDK); ws degrades
  // gracefully at runtime when they're absent, but esbuild must not resolve them.
  external: ["bufferutil", "utf-8-validate"]
});
