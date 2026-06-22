import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// 直接引用产品名常量文件(不经 shared 入口,避免把 zod 等拉进配置),
// 让 index.html 的标题也由唯一来源 PRODUCT_NAME 注入。
import { PRODUCT_NAME } from "../../packages/shared/src/product";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "inject-product-name",
      transformIndexHtml(html) {
        return html.replaceAll("%PRODUCT_NAME%", PRODUCT_NAME);
      }
    }
  ],
  root: ".",
  base: "./",
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
