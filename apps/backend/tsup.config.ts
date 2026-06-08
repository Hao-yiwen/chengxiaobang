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
    "exceljs"
  ]
});
