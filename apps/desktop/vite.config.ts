import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: ".",
  build: {
    outDir: "dist/renderer",
    emptyOutDir: false
  },
  resolve: {
    alias: {
      "@chengxiaobang/shared": fileURLToPath(
        new URL("../../packages/shared/src/index.ts", import.meta.url)
      ),
      "@": fileURLToPath(new URL("./src/renderer", import.meta.url))
    }
  }
});
