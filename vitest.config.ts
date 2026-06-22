import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Resolve aliases relative to this config file so tests work on any machine.
const fromRoot = (relative: string): string =>
  fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    environmentOptions: {
      jsdom: {
        url: "http://localhost/"
      }
    },
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
    include: [
      "packages/**/*.test.ts",
      "apps/**/*.test.ts",
      "apps/**/*.test.tsx"
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"]
    }
  },
  resolve: {
    alias: {
      // 子路径要排在前面,确保比宽泛的 "@chengxiaobang/shared" 先命中,直接解析到源码,
      // 这样未先 build shared(无 dist)时测试也能跑。
      "@chengxiaobang/shared/product": fromRoot("packages/shared/src/product.ts"),
      "@chengxiaobang/shared": fromRoot("packages/shared/src/index.ts"),
      "@chengxiaobang/backend": fromRoot("apps/backend/src"),
      "@chengxiaobang/desktop": fromRoot("apps/desktop/src"),
      "@": fromRoot("apps/desktop/src/renderer")
    }
  }
});
