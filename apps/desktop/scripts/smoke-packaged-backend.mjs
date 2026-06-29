import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { randomInt } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(desktopDir, "../..");
const smokeTimeoutMs = Number(process.env.CHENGXIAOBANG_SMOKE_TIMEOUT_MS ?? 20_000);

async function main() {
  const resourcesPath = await resolveResourcesPath();
  const bunPath = join(resourcesPath, process.platform === "win32" ? "bun.exe" : "bun");
  const rgPath = join(resourcesPath, process.platform === "win32" ? "rg.exe" : "rg");
  const backendEntry = join(resourcesPath, "backend", "main.js");
  await verifyPackagedResources(resourcesPath, bunPath, rgPath, backendEntry);
  await verifyPackagedMainRuntimeLoads(resourcesPath);

  const dataDir = await mkdtemp(join(tmpdir(), "cxb-packaged-backend-"));
  const port = Number(process.env.CHENGXIAOBANG_SMOKE_PORT ?? randomInt(20_000, 30_000));
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
      env: { ...process.env, CHENGXIAOBANG_LOG_LEVEL: "debug", CHENGXIAOBANG_RG_PATH: rgPath },
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
    for (const outName of ["mac", "mac-arm64", "mac-x64"]) {
      const macOut = resolve(desktopDir, "out", outName);
      const entries = existsSync(macOut) ? await readdir(macOut, { withFileTypes: true }) : [];
      const app = entries.find((entry) => entry.isDirectory() && entry.name.endsWith(".app"));
      if (app) {
        return join(macOut, app.name, "Contents", "Resources");
      }
    }
  }
  throw new Error(
    "未找到默认打包资源目录，请通过 CHENGXIAOBANG_PACKAGED_RESOURCES 指定 resources 路径"
  );
}

async function verifyPackagedResources(resourcesPath, bunPath, rgPath, backendEntry) {
  const canvasPackage = join(
    resourcesPath,
    "app.asar.unpacked",
    "node_modules",
    "@napi-rs",
    "canvas"
  );
  const requiredPaths = [
    resourcesPath,
    bunPath,
    rgPath,
    backendEntry,
    ...Object.values(getOcrModelPaths(resourcesPath)),
    join(resourcesPath, "app.asar.unpacked", "node_modules", "node-pty"),
    join(resourcesPath, "app.asar.unpacked", "node_modules", "sharp"),
    join(resourcesPath, "app.asar.unpacked", "node_modules", "onnxruntime-node"),
    canvasPackage,
    ...(process.platform === "darwin"
      ? [
          join(
            resourcesPath,
            "system-speech",
            "darwin",
            "SystemSpeechHelper.app",
            "Contents",
            "MacOS",
            "system-speech-helper"
          )
        ]
      : [])
  ];
  for (const path of requiredPaths) {
    if (!existsSync(path)) {
      throw new Error(`打包资源缺失: ${path}`);
    }
  }
  await verifyPackagedRuntimeCommand("ripgrep", rgPath, ["--version"], resourcesPath);
  const canvasNative = await findCanvasNativeBinding(resourcesPath, canvasPackage);
  if (!canvasNative) {
    const candidates = getCanvasNativeCandidates(resourcesPath, canvasPackage)
      .map((candidate) => candidate.path)
      .join(", ");
    throw new Error(`未找到 @napi-rs/canvas 当前平台 native 资源，已检查: ${candidates}`);
  }
  console.info("[smoke] 已找到 @napi-rs/canvas native 资源", {
    platform: process.platform,
    arch: process.arch,
    path: canvasNative.path,
    type: canvasNative.type
  });
  const sharpNative = await verifySharpNativeResources(resourcesPath);
  console.info("[smoke] 已找到 sharp native 资源", sharpNative);
  const onnxRuntimeNative = await verifyOnnxRuntimeNativeResources(resourcesPath);
  console.info("[smoke] 已找到 onnxruntime-node native 资源", onnxRuntimeNative);
  await verifyAppAsarRuntimeDependencies(resourcesPath);
}

async function verifyPackagedRuntimeCommand(name, command, args, cwd) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      timeout: 5_000,
      windowsHide: true
    });
    const version = (stdout || stderr).split(/\r?\n/).find(Boolean) ?? "unknown";
    console.info("[smoke] 打包运行时自检通过", { name, command, version });
  } catch (error) {
    throw new Error(
      `${name} 打包运行时自检失败 command=${command} args=${args.join(" ")} cwd=${cwd}: ${messageFromError(error)}`
    );
  }
}

async function verifyAppAsarRuntimeDependencies(resourcesPath) {
  const appAsar = join(resourcesPath, "app.asar");
  if (!existsSync(appAsar)) {
    throw new Error(`打包资源缺失: ${appAsar}`);
  }
  const asarBin = findAsarBin();
  if (!asarBin) {
    throw new Error(`未找到 asar 检查工具，已检查: ${getAsarBinCandidates().join(", ")}`);
  }
  const { stdout } = await execFileAsync(asarBin, ["list", appAsar], {
    cwd: repoRoot,
    shell: process.platform === "win32"
  });
  const entries = new Set(stdout.split(/\r?\n/).filter(Boolean).map(normalizeAsarEntry));
  await verifyPackagedRendererEntry(resourcesPath, entries);
  const requiredEntries = [
    "/node_modules/@pinojs/redact/index.js",
    "/node_modules/@img/colour/index.cjs",
    "/node_modules/@techstark/opencv-js/dist/opencv.js",
    "/node_modules/electron-updater/out/main.js",
    "/node_modules/atomic-sleep/index.js",
    "/node_modules/builder-util-runtime/out/index.js",
    "/node_modules/debug/src/index.js",
    "/node_modules/detect-libc/lib/detect-libc.js",
    "/node_modules/fs-extra/lib/index.js",
    "/node_modules/graceful-fs/graceful-fs.js",
    "/node_modules/js-yaml/index.js",
    "/node_modules/jsonfile/index.js",
    "/node_modules/lazy-val/out/main.js",
    "/node_modules/lodash.escaperegexp/index.js",
    "/node_modules/lodash.isequal/index.js",
    "/node_modules/ms/index.js",
    "/node_modules/on-exit-leak-free/index.js",
    "/node_modules/onnxruntime-common/dist/cjs/index.js",
    "/node_modules/pino/pino.js",
    "/node_modules/pino-abstract-transport/index.js",
    "/node_modules/pino-std-serializers/index.js",
    "/node_modules/ppu-ocv/index.js",
    "/node_modules/ppu-ocv/index.canvas.js",
    "/node_modules/ppu-paddle-ocr/index.js",
    "/node_modules/ppu-paddle-ocr/processor/paddle-ocr.service.js",
    "/node_modules/process-warning/index.js",
    "/node_modules/quick-format-unescaped/index.js",
    "/node_modules/real-require/src/index.js",
    "/node_modules/sax/lib/sax.js",
    "/node_modules/semver/index.js",
    "/node_modules/safe-stable-stringify/index.js",
    "/node_modules/sonic-boom/index.js",
    "/node_modules/split2/index.js",
    "/node_modules/thread-stream/index.js",
    "/node_modules/tiny-typed-emitter/lib/index.js",
    "/node_modules/universalify/index.js"
  ];
  const missingEntries = requiredEntries.filter((entry) => !entries.has(entry));
  if (missingEntries.length > 0) {
    const sampleEntries = [...entries].slice(0, 20).join(", ");
    throw new Error(
      `app.asar 缺少主进程运行时依赖: ${missingEntries.join(", ")}; 已读取条目样本: ${sampleEntries}`
    );
  }
  console.info("[smoke] app.asar 主进程运行时依赖检查通过", {
    appAsar,
    asarBin,
    checkedEntries: requiredEntries
  });
}

async function verifyPackagedRendererEntry(resourcesPath, entries) {
  const appAsar = join(resourcesPath, "app.asar");
  const asarBin = findAsarBin();
  const indexEntry = "/dist/renderer/index.html";
  if (!entries.has(indexEntry)) {
    throw new Error(`app.asar 缺少 renderer 入口: ${indexEntry}`);
  }
  const indexHtml = await readAppAsarTextFile(asarBin, appAsar, indexEntry.slice(1));
  const absoluteAssetRefs = [...indexHtml.matchAll(/\b(?:src|href)=["']\/assets\//g)].map(
    (match) => match[0]
  );
  if (absoluteAssetRefs.length > 0) {
    throw new Error(
      `renderer 入口包含 file:// 下不可加载的绝对资源路径: ${absoluteAssetRefs.join(", ")}`
    );
  }
  const relativeAssetRefs = [...indexHtml.matchAll(/\b(?:src|href)=["']\.\/assets\//g)].map(
    (match) => match[0]
  );
  if (relativeAssetRefs.length === 0) {
    throw new Error("renderer 入口未发现相对 assets 引用，可能无法在打包后的 file:// 页面加载");
  }
  console.info("[smoke] renderer 入口资源路径检查通过", {
    appAsar,
    indexEntry,
    relativeAssetRefs
  });
}

async function readAppAsarTextFile(asarBin, appAsar, entry) {
  if (!asarBin) {
    throw new Error(`未找到 asar 检查工具，无法读取 ${entry}`);
  }
  const extractDir = await mkdtemp(join(tmpdir(), "cxb-asar-renderer-"));
  try {
    await execFileAsync(asarBin, ["extract", appAsar, extractDir], {
      cwd: repoRoot,
      shell: process.platform === "win32",
      maxBuffer: 1024 * 1024
    });
    return await readFile(join(extractDir, entry), "utf8");
  } finally {
    await rm(extractDir, { recursive: true, force: true });
  }
}

async function verifyPackagedMainRuntimeLoads(resourcesPath) {
  const appAsar = join(resourcesPath, "app.asar");
  const electronExecutable = await resolvePackagedElectronExecutable(resourcesPath);
  const updaterSmokeScript = `
(async () => {
const appAsar = process.env.CHENGXIAOBANG_SMOKE_APP_ASAR;
const path = require("path");
const { pathToFileURL } = require("url");
const Module = require("module");
const { EventEmitter } = require("events");
const updaterOutDir = appAsar + "/node_modules/electron-updater/out";
const resourcesPath = path.dirname(appAsar);
const mainRuntimeDir = appAsar + "/dist/main";
const nativeAutoUpdater = new EventEmitter();
nativeAutoUpdater.setFeedURL = () => {};
nativeAutoUpdater.checkForUpdates = () => {};
nativeAutoUpdater.quitAndInstall = () => {};
const app = new EventEmitter();
app.whenReady = () => Promise.resolve();
app.getVersion = () => "0.1.5";
app.getName = () => "程小帮";
app.getAppPath = () => appAsar;
app.getPath = (name) => path.join(resourcesPath, "smoke-" + name);
app.isPackaged = true;
app.quit = () => {};
app.relaunch = () => {};
const electronStub = {
  app,
  autoUpdater: nativeAutoUpdater,
  session: { fromPartition: () => ({}) },
  net: { request: () => new EventEmitter() }
};
const originalLoad = Module._load;
Module._load = function loadWithElectronStub(request, parent, isMain) {
  if (request === "electron") {
    return electronStub;
  }
  return originalLoad.apply(this, arguments);
};
Object.defineProperty(process, "resourcesPath", {
  value: resourcesPath,
  configurable: true
});
const requiredModules = [
  "@pinojs/redact",
  "electron-updater",
  "atomic-sleep",
  "builder-util-runtime",
  "debug",
  "fs-extra",
  "graceful-fs",
  "js-yaml",
  "jsonfile",
  "lazy-val",
  "lodash.escaperegexp",
  "lodash.isequal",
  "ms",
  "on-exit-leak-free",
  "onnxruntime-common",
  "pino",
  "pino-abstract-transport",
  "pino-std-serializers",
  "ppu-ocv",
  "process-warning",
  "quick-format-unescaped",
  "real-require",
  "sax",
  "semver",
  "safe-stable-stringify",
  "sonic-boom",
  "split2",
  "thread-stream",
  "tiny-typed-emitter",
  "universalify"
];
for (const moduleName of requiredModules) {
  require.resolve(moduleName, { paths: [mainRuntimeDir, updaterOutDir] });
}
const pino = require(appAsar + "/node_modules/pino/pino.js");
if (typeof pino !== "function" || typeof pino.destination !== "function") {
  throw new Error("pino 没有导出预期的 logger 工厂");
}
const updater = require(appAsar + "/node_modules/electron-updater/out/main.js");
if (!updater || !updater.autoUpdater) {
  throw new Error("electron-updater 没有导出 autoUpdater");
}
const sharp = require(appAsar + "/node_modules/sharp");
if (typeof sharp !== "function" || !sharp.versions?.vips) {
  throw new Error("sharp 没有加载出预期的 native 运行时");
}
const onnx = require(appAsar + "/node_modules/onnxruntime-node");
if (!onnx?.InferenceSession || !onnx?.Tensor) {
  throw new Error("onnxruntime-node 没有加载出预期的运行时导出");
}
const ppuPaddleOcrEntry = pathToFileURL(path.join(appAsar, "node_modules", "ppu-paddle-ocr", "index.js")).href;
const { PaddleOcrService } = await import(ppuPaddleOcrEntry);
if (typeof PaddleOcrService !== "function") {
  throw new Error("ppu-paddle-ocr 没有导出 PaddleOcrService");
}
const ocrModelDir = path.join(resourcesPath, "ocr", "pp-ocrv6-small");
const service = new PaddleOcrService({
  model: {
    detection: path.join(ocrModelDir, "det.onnx"),
    recognition: path.join(ocrModelDir, "rec.onnx"),
    charactersDictionary: path.join(ocrModelDir, "dict.txt")
  },
  processing: { engine: "opencv" },
  session: { executionProviders: ["cpu"], graphOptimizationLevel: "all" },
  debugging: { debug: false, verbose: false }
});
await service.initialize();
await service.destroy?.();
console.log("[smoke] main process runtime load ok");
})().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
`;
  const { stdout } = await execFileAsync(electronExecutable, ["-e", updaterSmokeScript], {
    cwd: desktopDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      CHENGXIAOBANG_SMOKE_APP_ASAR: appAsar
    },
    timeout: Math.max(smokeTimeoutMs, 60_000),
    maxBuffer: 1024 * 1024
  });
  console.info("[smoke] 打包主进程运行时加载检查通过", {
    platform: process.platform,
    arch: process.arch,
    electronExecutable,
    stdout: stdout.trim()
  });
}

async function resolvePackagedElectronExecutable(resourcesPath) {
  if (process.platform === "darwin") {
    const contentsDir = dirname(resourcesPath);
    const appBundle = dirname(contentsDir);
    const executableName = appBundle.endsWith(".app")
      ? appBundle.slice(appBundle.lastIndexOf("/") + 1, -".app".length)
      : "程小帮";
    return join(contentsDir, "MacOS", executableName);
  }
  if (process.platform === "win32") {
    const appDir = dirname(resourcesPath);
    const entries = await readdir(appDir, { withFileTypes: true });
    const executable = entries.find((entry) => entry.isFile() && entry.name.endsWith(".exe"));
    if (executable) {
      return join(appDir, executable.name);
    }
  }
  throw new Error(`未找到打包 Electron 可执行文件 resourcesPath=${resourcesPath}`);
}

function findAsarBin() {
  return getAsarBinCandidates().find((candidate) => existsSync(candidate)) ?? null;
}

function normalizeAsarEntry(entry) {
  const normalized = entry.replaceAll("\\", "/");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function getAsarBinCandidates() {
  const names = process.platform === "win32" ? ["asar.cmd", "asar.ps1", "asar"] : ["asar"];
  const dirs = [
    join(desktopDir, "node_modules", ".bin"),
    join(repoRoot, "node_modules", ".bin"),
    join(repoRoot, "node_modules", ".pnpm", "node_modules", ".bin")
  ];
  return dirs.flatMap((dir) => names.map((name) => join(dir, name)));
}

async function findCanvasNativeBinding(resourcesPath, canvasPackage) {
  for (const candidate of getCanvasNativeCandidates(resourcesPath, canvasPackage)) {
    if (!existsSync(candidate.path)) {
      continue;
    }
    if (candidate.type === "file") {
      return candidate;
    }
    const entries = await readdir(candidate.path).catch(() => []);
    if (entries.some((entry) => entry.endsWith(".node"))) {
      return candidate;
    }
  }
  return null;
}

function getCanvasNativeCandidates(resourcesPath, canvasPackage) {
  const napiScope = join(resourcesPath, "app.asar.unpacked", "node_modules", "@napi-rs");
  if (process.platform === "win32" && process.arch === "x64") {
    return [
      { type: "file", path: join(canvasPackage, "skia.win32-x64-msvc.node") },
      { type: "file", path: join(canvasPackage, "skia.win32-x64-gnu.node") },
      { type: "directory", path: join(napiScope, "canvas-win32-x64-msvc") },
      { type: "directory", path: join(napiScope, "canvas-win32-x64-gnu") }
    ];
  }
  if (process.platform === "darwin") {
    const archSuffix = process.arch === "arm64" ? "arm64" : "x64";
    return [
      { type: "file", path: join(canvasPackage, "skia.darwin-universal.node") },
      { type: "file", path: join(canvasPackage, `skia.darwin-${archSuffix}.node`) },
      { type: "directory", path: join(napiScope, "canvas-darwin-universal") },
      { type: "directory", path: join(napiScope, `canvas-darwin-${archSuffix}`) }
    ];
  }
  return [
    { type: "file", path: join(canvasPackage, `skia.${process.platform}-${process.arch}.node`) }
  ];
}

async function verifySharpNativeResources(resourcesPath) {
  const platformArch = getSharpRuntimePlatformArch();
  const imgScope = join(resourcesPath, "app.asar.unpacked", "node_modules", "@img");
  const sharpPackage = join(imgScope, `sharp-${platformArch}`);
  const sharpNative = join(sharpPackage, "lib", `sharp-${platformArch}.node`);
  const requiredPaths = [sharpPackage, sharpNative];
  const result = {
    platform: process.platform,
    arch: process.arch,
    platformArch,
    sharpPackage,
    sharpNative
  };

  if (process.platform === "darwin") {
    const libvipsPackage = join(imgScope, `sharp-libvips-${platformArch}`);
    requiredPaths.push(libvipsPackage);
    Object.assign(result, { libvipsPackage });
  }

  for (const path of requiredPaths) {
    if (!existsSync(path)) {
      throw new Error(`打包 sharp native 资源缺失: ${path}`);
    }
  }

  if ("libvipsPackage" in result) {
    const libvipsLibDir = join(result.libvipsPackage, "lib");
    const entries = await readdir(libvipsLibDir).catch(() => []);
    if (!entries.some((entry) => entry.endsWith(".dylib"))) {
      throw new Error(`打包 sharp libvips 资源缺少 dylib: ${libvipsLibDir}`);
    }
  }

  return result;
}

async function verifyOnnxRuntimeNativeResources(resourcesPath) {
  const onnxPackage = join(
    resourcesPath,
    "app.asar.unpacked",
    "node_modules",
    "onnxruntime-node"
  );
  const candidates = getOnnxRuntimeNativeCandidates(onnxPackage);
  const nativeBinding = candidates.find((candidate) => existsSync(candidate));
  if (!nativeBinding) {
    throw new Error(`打包 onnxruntime-node native 资源缺失，已检查: ${candidates.join(", ")}`);
  }
  const result = {
    platform: process.platform,
    arch: process.arch,
    nativeBinding
  };
  if (process.platform === "darwin") {
    const nativeDir = dirname(nativeBinding);
    const entries = await readdir(nativeDir).catch(() => []);
    const dylibs = entries.filter((entry) => entry.endsWith(".dylib"));
    if (dylibs.length === 0) {
      throw new Error(`打包 onnxruntime-node native 资源缺少 dylib: ${nativeDir}`);
    }
    Object.assign(result, { dylibs });
  }
  return result;
}

function getOnnxRuntimeNativeCandidates(onnxPackage) {
  if (process.platform === "win32") {
    return [
      join(onnxPackage, "bin", "napi-v6", "win32", process.arch, "onnxruntime_binding.node")
    ];
  }
  if (process.platform === "darwin") {
    return [
      join(onnxPackage, "bin", "napi-v6", "darwin", process.arch, "onnxruntime_binding.node")
    ];
  }
  return [
    join(onnxPackage, "bin", "napi-v6", process.platform, process.arch, "onnxruntime_binding.node")
  ];
}

function getSharpRuntimePlatformArch() {
  if (process.platform === "darwin") {
    return `darwin-${process.arch === "arm64" ? "arm64" : "x64"}`;
  }
  if (process.platform === "win32") {
    return `win32-${process.arch}`;
  }
  return `${process.platform}-${process.arch}`;
}

function getOcrModelPaths(resourcesPath) {
  const modelDir = join(resourcesPath, "ocr", "pp-ocrv6-small");
  return {
    detection: join(modelDir, "det.onnx"),
    recognition: join(modelDir, "rec.onnx"),
    charactersDictionary: join(modelDir, "dict.txt")
  };
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
