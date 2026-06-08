import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

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
      "@chengxiaobang/shared": "/Users/minimax/Documents/chengxiaobang/packages/shared/src/index.ts",
      "@chengxiaobang/backend": "/Users/minimax/Documents/chengxiaobang/apps/backend/src",
      "@chengxiaobang/desktop": "/Users/minimax/Documents/chengxiaobang/apps/desktop/src",
      "@": "/Users/minimax/Documents/chengxiaobang/apps/desktop/src/renderer"
    }
  }
});
