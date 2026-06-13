import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { randomInt } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const smokeTimeoutMs = Number(process.env.CHENGXIAOBANG_SMOKE_TIMEOUT_MS ?? 20_000);

async function main() {
  const resourcesPath = await resolveResourcesPath();
  const bunPath = join(resourcesPath, process.platform === "win32" ? "bun.exe" : "bun");
  const backendEntry = join(resourcesPath, "backend", "main.js");
  await verifyPackagedResources(resourcesPath, bunPath, backendEntry);

  const dataDir = await mkdtemp(join(tmpdir(), "cxb-packaged-backend-"));
  const port = Number(process.env.CHENGXIAOBANG_SMOKE_PORT ?? randomInt(30_000, 50_000));
  const token = `smoke-${Date.now()}`;
  console.info("[smoke] 准备启动打包后端", {
    platform: process.platform,
    arch: process.arch,
    resourcesPath,
    bunPath,
    backendEntry,
    port,
    dataDir
  });

  const child = spawn(
    bunPath,
    [backendEntry, "--port", String(port), "--data-dir", dataDir, "--token", token],
    {
      cwd: desktopDir,
      env: { ...process.env, CHENGXIAOBANG_LOG_LEVEL: "debug" },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    const text = String(chunk);
    stdout += text;
    process.stdout.write(`[backend:stdout] ${text}`);
  });
  child.stderr.on("data", (chunk) => {
    const text = String(chunk);
    stderr += text;
    process.stderr.write(`[backend:stderr] ${text}`);
  });

  try {
    await waitForHealth(port, child);
    console.info("[smoke] 打包后端 health check 成功", {
      platform: process.platform,
      arch: process.arch,
      port
    });
  } catch (error) {
    console.error("[smoke] 打包后端 health check 失败", {
      platform: process.platform,
      arch: process.arch,
      bunPath,
      backendEntry,
      port,
      exitCode: child.exitCode,
      error: messageFromError(error),
      stdout: stdout.slice(-1_000),
      stderr: stderr.slice(-1_000)
    });
    throw error;
  } finally {
    await stopChild(child);
    await rm(dataDir, { recursive: true, force: true });
  }
}

async function resolveResourcesPath() {
  if (process.env.CHENGXIAOBANG_PACKAGED_RESOURCES) {
    return resolve(process.env.CHENGXIAOBANG_PACKAGED_RESOURCES);
  }
  if (process.platform === "win32") {
    return resolve(desktopDir, "out", "win-unpacked", "resources");
  }
  if (process.platform === "darwin") {
    const macOut = resolve(desktopDir, "out", "mac");
    const entries = existsSync(macOut) ? await readdir(macOut, { withFileTypes: true }) : [];
    const app = entries.find((entry) => entry.isDirectory() && entry.name.endsWith(".app"));
    if (app) {
      return join(macOut, app.name, "Contents", "Resources");
    }
  }
  throw new Error(
    "未找到默认打包资源目录，请通过 CHENGXIAOBANG_PACKAGED_RESOURCES 指定 resources 路径"
  );
}

async function verifyPackagedResources(resourcesPath, bunPath, backendEntry) {
  const requiredPaths = [
    resourcesPath,
    bunPath,
    backendEntry,
    join(resourcesPath, "ocr", "pp-ocrv6-small", "det.onnx"),
    join(resourcesPath, "ocr", "pp-ocrv6-small", "rec.onnx"),
    join(resourcesPath, "ocr", "pp-ocrv6-small", "dict.txt"),
    join(resourcesPath, "app.asar.unpacked", "node_modules", "node-pty"),
    join(resourcesPath, "app.asar.unpacked", "node_modules", "sharp"),
    join(resourcesPath, "app.asar.unpacked", "node_modules", "onnxruntime-node"),
    join(resourcesPath, "app.asar.unpacked", "node_modules", "@napi-rs", "canvas")
  ];
  for (const path of requiredPaths) {
    if (!existsSync(path)) {
      throw new Error(`打包资源缺失: ${path}`);
    }
  }
  const napiScope = join(resourcesPath, "app.asar.unpacked", "node_modules", "@napi-rs");
  const napiEntries = await readdir(napiScope).catch(() => []);
  if (!napiEntries.some((name) => name.startsWith("canvas-"))) {
    throw new Error(`未找到 @napi-rs/canvas 平台原生包: ${napiScope}`);
  }
}

async function waitForHealth(port, child) {
  const deadline = Date.now() + smokeTimeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`后端进程提前退出 exitCode=${child.exitCode}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) {
        const payload = await response.json();
        if (payload?.ok === true) {
          return;
        }
        lastError = new Error(`health 响应异常: ${JSON.stringify(payload)}`);
      } else {
        lastError = new Error(`health HTTP ${response.status}`);
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`后端 health check 超时 timeoutMs=${smokeTimeoutMs}`);
}

async function stopChild(child) {
  if (!child.pid || child.exitCode !== null) {
    return;
  }
  if (process.platform === "win32") {
    try {
      await execFileAsync("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
      return;
    } catch (error) {
      console.warn("[smoke] taskkill 清理后端失败，回退 child.kill", {
        pid: child.pid,
        error: messageFromError(error)
      });
    }
  }
  child.kill("SIGTERM");
  await sleep(500);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
  }
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function messageFromError(error) {
  return error instanceof Error ? error.message : String(error);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
