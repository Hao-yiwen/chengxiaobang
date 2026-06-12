import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 后端测试若未显式注入 sessionWorkspacePath,AgentRunner 会落到
// ~/.chengxiaobang/<sessionId> 创建工作目录;统一重定向到临时目录,
// 避免测试在用户真实 home 下堆积孤儿 session 目录。
process.env.CHENGXIAOBANG_HOME = mkdtempSync(join(tmpdir(), "chengxiaobang-test-"));

function createLocalStorageMock(): Storage {
  const values = new Map<string, string>();
  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
    get length() {
      return values.size;
    }
  };
}

function hasUsableLocalStorage(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  try {
    window.localStorage.setItem("__vitest_probe__", "1");
    window.localStorage.removeItem("__vitest_probe__");
    return true;
  } catch {
    return false;
  }
}

if (typeof window !== "undefined" && !hasUsableLocalStorage()) {
  const localStorage = createLocalStorageMock();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorage
  });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: localStorage
    });
  }
}
