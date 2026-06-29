import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SystemSpeechManager } from "../src/main/system-speech";

const fakeHelperSource = `
import { writeFileSync } from "node:fs";

const mode = process.env.CXB_FAKE_SPEECH_MODE ?? "normal";
const marker = process.env.CXB_FAKE_SPEECH_MARKER;

function emit(payload) {
  process.stdout.write(JSON.stringify(payload) + "\\n");
}

if (mode === "exit-error") {
  process.stderr.write("fake helper boom\\n");
  process.exit(7);
}

if (mode === "silent") {
  process.on("SIGTERM", () => {
    if (marker) {
      writeFileSync(marker, "terminated");
    }
    process.exit(0);
  });
  process.stdin.resume();
  setInterval(() => {}, 1000);
} else {
  emit({ type: "ready", language: "zh-CN" });
  setTimeout(() => emit({ type: "level", language: "zh-CN", level: 0.42, elapsedMs: 12 }), 5);
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    for (const line of String(chunk).split(/\\r?\\n/)) {
      const command = line.trim();
      if (command === "stop") {
        emit({ type: "final", language: "zh-CN", text: "你好程小帮", elapsedMs: 120 });
        process.exit(0);
      }
      if (command === "cancel") {
        emit({ type: "cancelled", language: "zh-CN", text: "", elapsedMs: 10 });
        process.exit(0);
      }
    }
  });
}
`;

describe("SystemSpeechManager", () => {
  let tempDir: string;
  let helperScript: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "cxb-system-speech-test-"));
    helperScript = join(tempDir, "fake-system-speech-helper.mjs");
    await writeFile(helperScript, fakeHelperSource, "utf8");
    process.env.CXB_FAKE_SPEECH_MODE = "normal";
  });

  afterEach(async () => {
    delete process.env.CXB_FAKE_SPEECH_MODE;
    delete process.env.CXB_FAKE_SPEECH_MARKER;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("starts and stops a fake helper through stdio", async () => {
    const manager = createManager(helperScript);
    const levelEvents: number[] = [];

    const start = await manager.start("zh-CN", (event) => {
      levelEvents.push(event.level);
    });

    expect(start).toMatchObject({ ok: true });
    if (!start.ok) {
      throw new Error(start.error);
    }

    await eventually(() => {
      expect(levelEvents).toContain(0.42);
    });

    const stop = await manager.stop(start.sessionId);

    expect(stop).toEqual({
      ok: true,
      sessionId: start.sessionId,
      text: "你好程小帮",
      elapsedMs: 120
    });
  });

  it("kills a helper that never becomes ready and clears the active session", async () => {
    process.env.CXB_FAKE_SPEECH_MODE = "silent";
    const marker = join(tempDir, "terminated.txt");
    process.env.CXB_FAKE_SPEECH_MARKER = marker;
    const manager = createManager(helperScript);

    const result = await manager.start("zh-CN");

    expect(result).toEqual({ ok: false, error: "系统语音 helper 启动超时" });
    if (process.platform !== "win32") {
      await eventually(() => {
        expect(existsSync(marker)).toBe(true);
      });
      await expect(readFile(marker, "utf8")).resolves.toBe("terminated");
    }

    process.env.CXB_FAKE_SPEECH_MODE = "normal";
    const next = await manager.start("zh-CN");
    expect(next).toMatchObject({ ok: true });
    if (next.ok) {
      await manager.cancel(next.sessionId);
    }
  });

  it("surfaces immediate helper exit without waiting for the ready timeout", async () => {
    process.env.CXB_FAKE_SPEECH_MODE = "exit-error";
    const manager = createManager(helperScript, { readyTimeoutMs: 2_000 });
    const startedAt = Date.now();

    const result = await manager.start("zh-CN");

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("code=7");
      expect(result.error).toContain("fake helper boom");
    }
  });
});

function createManager(
  helperScript: string,
  options: { readyTimeoutMs?: number; stopTimeoutMs?: number } = {}
): SystemSpeechManager {
  return new SystemSpeechManager({
    appPath: "/tmp/ChengXiaoBang.app",
    resourcesPath: "/tmp/resources",
    isPackaged: false,
    platform: "darwin",
    darwinHelperPath: process.execPath,
    darwinHelperArgsPrefix: [helperScript],
    readyTimeoutMs: options.readyTimeoutMs ?? 200,
    stopTimeoutMs: options.stopTimeoutMs ?? 500
  });
}

async function eventually(assertion: () => void, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw lastError;
}
