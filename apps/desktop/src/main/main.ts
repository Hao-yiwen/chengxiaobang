import { app, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme, shell } from "electron";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, open as openFile, readFile, readdir, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  BINARY_PREVIEW_MAX_BYTES,
  QUICK_LOOK_THUMBNAIL_SIZE,
  TEXT_PREVIEW_MAX_BYTES,
  extensionOf,
  previewDescriptorForPath,
  previewReadLimitForKind,
  type PreviewKind
} from "../common/file-preview";
import { startBackendProcess, type BackendProcess } from "./backend-process";
import {
  detectInstalledProjectOpeners,
  projectOpenerBundleIconFileNames,
  projectOpenerSearchDirs
} from "./ide";
import {
  initializeDesktopLogging,
  logRendererConsole,
  writeStructuredLog,
  writeTerminalLog
} from "./logging";
import { isHttpUrl, shouldAllowWebviewSrc, shouldOpenExternalFromAppWindow } from "./navigation";
import { defaultDataDir, defaultLogDir, devDockIconPath, preloadPath, rendererIndexPath } from "./paths";
import {
  previewPathCandidates,
  type FilePreviewResolveContext
} from "./file-preview-path";
import { registerTerminalIpc, type TerminalSessionManager } from "./terminal";

const MAX_CONTEXT_FILE_BYTES = 256 * 1024;
const desktopLogging = initializeDesktopLogging({ logDir: defaultLogDir() });

if (desktopLogging) {
  console.info(`[main] 日志写入目录 logDir=${desktopLogging.logDir} level=${desktopLogging.level}`);
}

type ReadFileResult =
  | { path: string; name: string; ok: true; text: string; size: number }
  | { path: string; name: string; ok: false; error: string; size: number };

type FilePreviewInfoResult =
  | {
      ok: true;
      path: string;
      name: string;
      size: number;
      extension: string;
      kind: PreviewKind;
      label: string;
      canPreview: boolean;
    }
  | { ok: false; path: string; name: string; error: string };

type ReadFilePreviewTextResult =
  | { ok: true; path: string; name: string; text: string; size: number; truncated: boolean }
  | { ok: false; path: string; name: string; error: string; size: number };

type ReadFilePreviewBufferResult =
  | { ok: true; path: string; name: string; data: ArrayBuffer; size: number; truncated: boolean }
  | { ok: false; path: string; name: string; error: string; size: number };

type FileUrlResult =
  | { ok: true; path: string; url: string }
  | { ok: false; path: string; error: string };

type QuickLookThumbnailResult =
  | { ok: true; path: string; url: string }
  | { ok: false; path: string; error: string };

interface ResolvedPreviewPath {
  path: string;
  name: string;
  size: number;
}

function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8192);
  for (const byte of sample) {
    if (byte === 0) {
      return true;
    }
  }
  return false;
}

function normalizedReadLimit(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.max(1024, Math.min(Math.floor(value), BINARY_PREVIEW_MAX_BYTES));
}

function arrayBufferFromBuffer(buffer: Buffer): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);
  return arrayBuffer;
}

function normalizePreviewContext(value: unknown): FilePreviewResolveContext {
  if (!value || typeof value !== "object") {
    return {};
  }
  const input = value as { projectPath?: unknown; sessionId?: unknown };
  return {
    ...(typeof input.projectPath === "string" && input.projectPath
      ? { projectPath: input.projectPath }
      : {}),
    ...(typeof input.sessionId === "string" && input.sessionId ? { sessionId: input.sessionId } : {})
  };
}

async function resolveExistingPreviewPath(
  rawPath: string,
  context: FilePreviewResolveContext
): Promise<ResolvedPreviewPath> {
  const candidates = previewPathCandidates(rawPath, context);
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (candidate !== rawPath) {
        console.info(`[main] 文件预览路径已解析 raw=${rawPath} resolved=${candidate}`);
      }
      return { path: candidate, name: basename(candidate), size: info.size };
    } catch (error) {
      lastError = error;
    }
  }
  const message = lastError ? messageFromError(lastError) : "没有可用的候选路径";
  console.warn(
    `[main] 文件预览路径解析失败 raw=${rawPath} candidates=${JSON.stringify(candidates)} error=${message}`
  );
  throw new Error(message);
}

let mainWindow: BrowserWindow | undefined;
let backend: BackendProcess | undefined;
const projectOpenerIconCache = new Map<string, string | undefined>();
let terminalManager: TerminalSessionManager | undefined;

function stopBackend(reason: string): void {
  if (!backend) {
    return;
  }
  console.info(`[main] 停止后端 reason=${reason}`);
  backend.stop();
  backend = undefined;
}

function openExternalFromAppWindow(url: string, reason: string): boolean {
  const shouldOpen = shouldOpenExternalFromAppWindow(url, {
    currentUrl: mainWindow?.webContents.getURL(),
    devServerUrl: process.env.VITE_DEV_SERVER_URL
  });
  if (!shouldOpen) {
    return false;
  }
  console.info(`[main] 主窗口外链转交系统浏览器 reason=${reason} url=${url}`);
  void shell.openExternal(url);
  return true;
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function rendererConsoleLevelFromElectron(level: string): number {
  if (level === "error") {
    return 3;
  }
  if (level === "warning") {
    return 2;
  }
  if (level === "debug") {
    return 0;
  }
  return 1;
}

async function execFileOutput(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

async function readBundleIconName(appPath: string): Promise<string | undefined> {
  const infoPath = join(appPath, "Contents", "Info.plist");
  try {
    const plutilIcon = (
      await execFileOutput(
      "/usr/bin/plutil",
        ["-extract", "CFBundleIconFile", "raw", "-o", "-", infoPath]
      )
    ).trim();
    if (plutilIcon) {
      return plutilIcon;
    }
  } catch {
    // 有些 Info.plist 无法被 plutil raw extract 直接读取，下面用文本兜底。
  }
  try {
    const plist = await readFile(infoPath, "utf8");
    const match = plist.match(/<key>CFBundleIconFile<\/key>\s*<string>([^<]+)<\/string>/);
    return match?.[1];
  } catch (error) {
    console.warn(`[main] 项目打开器 Info.plist 读取失败 appPath=${appPath}: ${messageFromError(error)}`);
    return undefined;
  }
}

async function convertIcnsToDataUrl(iconPath: string): Promise<string | undefined> {
  const tempDir = await mkdtemp(join(tmpdir(), "cxb-project-opener-icon-"));
  const pngPath = join(tempDir, "icon.png");
  try {
    await execFileOutput("/usr/bin/sips", ["-s", "format", "png", iconPath, "--out", pngPath]);
    const png = await readFile(pngPath);
    if (png.byteLength === 0) {
      console.warn(`[main] 项目打开器 sips 图标转换为空 iconPath=${iconPath}`);
      return undefined;
    }
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch (error) {
    console.warn(`[main] 项目打开器 sips 图标转换失败 iconPath=${iconPath}: ${messageFromError(error)}`);
    return undefined;
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function loadBundleIconDataUrl(appPath: string): Promise<string | undefined> {
  const iconName = await readBundleIconName(appPath);
  if (!iconName) {
    return undefined;
  }
  for (const iconFileName of projectOpenerBundleIconFileNames(iconName)) {
    const iconPath = join(appPath, "Contents", "Resources", iconFileName);
    if (!existsSync(iconPath)) {
      continue;
    }
    const dataUrl = await convertIcnsToDataUrl(iconPath);
    if (dataUrl) {
      console.info(`[main] 项目打开器使用 bundle 图标 appPath=${appPath} iconPath=${iconPath}`);
      return dataUrl;
    }
  }
  return undefined;
}

async function loadProjectOpenerIconDataUrl(appPath: string): Promise<string | undefined> {
  if (projectOpenerIconCache.has(appPath)) {
    return projectOpenerIconCache.get(appPath);
  }
  const dataUrl = await loadBundleIconDataUrl(appPath);
  if (!dataUrl) {
    console.warn(`[main] 项目打开器未找到可用 bundle 图标 appPath=${appPath}`);
  }
  projectOpenerIconCache.set(appPath, dataUrl);
  return dataUrl;
}

async function filePreviewInfo(
  target: unknown,
  contextInput?: unknown
): Promise<FilePreviewInfoResult> {
  const rawPath = typeof target === "string" ? target : "";
  const fallbackName = basename(rawPath);
  if (!rawPath) {
    console.warn("[main] 文件预览信息请求收到无效路径");
    return { ok: false, path: rawPath, name: fallbackName, error: "无效路径" };
  }
  try {
    const resolved = await resolveExistingPreviewPath(rawPath, normalizePreviewContext(contextInput));
    const descriptor = previewDescriptorForPath(resolved.path);
    console.info(
      `[main] 文件预览信息 path=${resolved.path} kind=${descriptor.kind} size=${resolved.size} canPreview=${descriptor.canPreview}`
    );
    return {
      ok: true,
      path: resolved.path,
      name: resolved.name,
      size: resolved.size,
      extension: extensionOf(resolved.path),
      kind: descriptor.kind,
      label: descriptor.label,
      canPreview: descriptor.canPreview
    };
  } catch (error) {
    const message = messageFromError(error);
    console.warn(`[main] 文件预览信息读取失败 path=${rawPath}: ${message}`);
    return { ok: false, path: rawPath, name: fallbackName, error: message };
  }
}

async function readFilePreviewText(
  target: unknown,
  options: unknown
): Promise<ReadFilePreviewTextResult> {
  const path = typeof target === "string" ? target : "";
  const name = basename(path);
  const limit = normalizedReadLimit(
    typeof options === "object" && options ? (options as { maxBytes?: unknown }).maxBytes : undefined,
    TEXT_PREVIEW_MAX_BYTES
  );
  if (!path) {
    console.warn("[main] 文本预览请求收到无效路径");
    return { ok: false, path, name, error: "无效路径", size: 0 };
  }
  try {
    const info = await stat(path);
    const truncated = info.size > limit;
    const file = await openFile(path, "r");
    try {
      const buffer = Buffer.alloc(Math.min(info.size, limit));
      await file.read(buffer, 0, buffer.byteLength, 0);
      if (looksBinary(buffer)) {
        console.warn(`[main] 文本预览拒绝二进制文件 path=${path} size=${info.size}`);
        return { ok: false, path, name, error: "该文件看起来是二进制内容", size: info.size };
      }
      console.info(
        `[main] 文本预览读取完成 path=${path} size=${info.size} limit=${limit} truncated=${truncated}`
      );
      return {
        ok: true,
        path,
        name,
        text: buffer.toString("utf8"),
        size: info.size,
        truncated
      };
    } finally {
      await file.close();
    }
  } catch (error) {
    const message = messageFromError(error);
    console.warn(`[main] 文本预览读取失败 path=${path}: ${message}`);
    return { ok: false, path, name, error: message, size: 0 };
  }
}

async function readFilePreviewBuffer(
  target: unknown,
  options: unknown
): Promise<ReadFilePreviewBufferResult> {
  const path = typeof target === "string" ? target : "";
  const name = basename(path);
  const descriptor = previewDescriptorForPath(path);
  const limit = normalizedReadLimit(
    typeof options === "object" && options ? (options as { maxBytes?: unknown }).maxBytes : undefined,
    previewReadLimitForKind(descriptor.kind)
  );
  if (!path) {
    console.warn("[main] 二进制预览请求收到无效路径");
    return { ok: false, path, name, error: "无效路径", size: 0 };
  }
  try {
    const info = await stat(path);
    if (info.size > limit) {
      console.warn(
        `[main] 二进制预览文件过大 path=${path} size=${info.size} limit=${limit} kind=${descriptor.kind}`
      );
      return {
        ok: false,
        path,
        name,
        error: `文件过大（上限 ${Math.round(limit / 1024 / 1024)}MB）`,
        size: info.size
      };
    }
    const buffer = await readFile(path);
    console.info(`[main] 二进制预览读取完成 path=${path} size=${info.size} kind=${descriptor.kind}`);
    return {
      ok: true,
      path,
      name,
      data: arrayBufferFromBuffer(buffer),
      size: info.size,
      truncated: false
    };
  } catch (error) {
    const message = messageFromError(error);
    console.warn(`[main] 二进制预览读取失败 path=${path}: ${message}`);
    return { ok: false, path, name, error: message, size: 0 };
  }
}

async function createPreviewFileUrl(target: unknown): Promise<FileUrlResult> {
  const path = typeof target === "string" ? target : "";
  if (!path) {
    console.warn("[main] file URL 请求收到无效路径");
    return { ok: false, path, error: "无效路径" };
  }
  try {
    await stat(path);
    const url = pathToFileURL(path).toString();
    console.info(`[main] 已生成本地预览 URL path=${path}`);
    return { ok: true, path, url };
  } catch (error) {
    const message = messageFromError(error);
    console.warn(`[main] 本地预览 URL 生成失败 path=${path}: ${message}`);
    return { ok: false, path, error: message };
  }
}

async function createQuickLookThumbnail(target: unknown): Promise<QuickLookThumbnailResult> {
  const path = typeof target === "string" ? target : "";
  if (!path) {
    console.warn("[main] Quick Look 缩略图请求收到无效路径");
    return { ok: false, path, error: "无效路径" };
  }
  if (process.platform !== "darwin") {
    console.info(`[main] 非 macOS 环境跳过 Quick Look 缩略图 path=${path}`);
    return { ok: false, path, error: "当前系统不支持 Quick Look 缩略图" };
  }
  const tempDir = await mkdtemp(join(tmpdir(), "cxb-preview-ql-"));
  try {
    console.info(`[main] 开始生成 Quick Look 缩略图 path=${path}`);
    await execFileOutput("/usr/bin/qlmanage", [
      "-t",
      "-s",
      String(QUICK_LOOK_THUMBNAIL_SIZE),
      "-o",
      tempDir,
      path
    ]);
    const files = await readdir(tempDir);
    const png = files.find((file) => file.toLowerCase().endsWith(".png"));
    if (!png) {
      console.warn(`[main] Quick Look 未生成 PNG 缩略图 path=${path}`);
      return { ok: false, path, error: "未生成可用缩略图" };
    }
    const image = await readFile(join(tempDir, png));
    console.info(`[main] Quick Look 缩略图生成完成 path=${path} bytes=${image.byteLength}`);
    return { ok: true, path, url: `data:image/png;base64,${image.toString("base64")}` };
  } catch (error) {
    const message = messageFromError(error);
    console.warn(`[main] Quick Look 缩略图生成失败 path=${path}: ${message}`);
    return { ok: false, path, error: message };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function createWindow(): Promise<void> {
  backend = await startBackendProcess({
    dataDir: defaultDataDir(),
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged,
    logger: desktopLogging?.backend
  });

  ipcMain.handle("backend-info", () => backend?.info);
  terminalManager ??= registerTerminalIpc(ipcMain);

  ipcMain.handle("open-skills-dir", async () => {
    const dir = join(homedir(), ".chengxiaobang", "skills");
    await mkdir(dir, { recursive: true });
    await shell.openPath(dir);
    return { ok: true, path: dir };
  });

  // 在用户默认应用中打开生成的文件产物（pptx/docx/xlsx 等）。
  ipcMain.handle("open-path", async (_event, target: unknown) => {
    if (typeof target !== "string" || target.length === 0) {
      console.warn("[main] 打开本地路径收到无效参数");
      return { ok: false, error: "无效路径" };
    }
    const error = await shell.openPath(target);
    if (error) {
      console.warn(`[main] 打开本地路径失败 target=${target}: ${error}`);
      return { ok: false, error };
    }
    console.info(`[main] 已交给系统打开本地路径 target=${target}`);
    return { ok: true };
  });

  ipcMain.handle("file-preview:info", (_event, target: unknown, context: unknown) =>
    filePreviewInfo(target, context)
  );
  ipcMain.handle("file-preview:read-text", (_event, target: unknown, options: unknown) =>
    readFilePreviewText(target, options)
  );
  ipcMain.handle("file-preview:read-buffer", (_event, target: unknown, options: unknown) =>
    readFilePreviewBuffer(target, options)
  );
  ipcMain.handle("file-preview:file-url", (_event, target: unknown) => createPreviewFileUrl(target));
  ipcMain.handle("file-preview:quicklook-thumbnail", (_event, target: unknown) =>
    createQuickLookThumbnail(target)
  );

  ipcMain.handle("detect-project-openers", async () => {
    const openers = await detectInstalledProjectOpeners(
      projectOpenerSearchDirs(homedir()),
      existsSync,
      loadProjectOpenerIconDataUrl
    );
    console.info(`[main] 项目打开器检测完成 count=${openers.length}`);
    return openers;
  });

  // 使用已安装的本机应用打开项目目录。
  ipcMain.handle("open-project-in-app", async (_event, appPath: unknown, target: unknown) => {
    if (typeof appPath !== "string" || typeof target !== "string" || target.length === 0) {
      console.error(
        `[main] 项目打开器收到无效参数 appPath=${String(appPath)} target=${String(target)}`
      );
      return { ok: false, error: "无效参数" };
    }
    const installed = await detectInstalledProjectOpeners(
      projectOpenerSearchDirs(homedir()),
      existsSync
    );
    if (!installed.some((opener) => opener.appPath === appPath)) {
      console.error(`[main] 拒绝打开未知项目打开器 appPath=${appPath} target=${target}`);
      return { ok: false, error: "未知项目打开器" };
    }
    return new Promise((resolve) => {
      execFile("open", ["-a", appPath, target], (error) => {
        if (error) {
          console.error(`[main] 项目打开失败 appPath=${appPath} target=${target}:`, error.message);
          resolve({ ok: false, error: error.message });
        } else {
          console.info(`[main] 已用本机应用打开项目 appPath=${appPath} target=${target}`);
          resolve({ ok: true });
        }
      });
    });
  });

  ipcMain.handle("set-theme-source", (_event, source: unknown) => {
    if (source === "light" || source === "dark" || source === "system") {
      nativeTheme.themeSource = source;
    }
  });

  ipcMain.handle("pick-directory", async () => {
    if (!mainWindow) {
      return undefined;
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return undefined;
    }
    return result.filePaths[0];
  });

  ipcMain.handle("pick-files", async () => {
    if (!mainWindow) {
      return [];
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile", "multiSelections"]
    });
    if (result.canceled) {
      return [];
    }
    return result.filePaths;
  });

  ipcMain.handle("read-file-text", async (_event, filePath: unknown): Promise<ReadFileResult> => {
    const path = typeof filePath === "string" ? filePath : "";
    const name = basename(path);
    try {
      const info = await stat(path);
      if (info.size > MAX_CONTEXT_FILE_BYTES) {
        return { path, name, ok: false, error: "文件过大（上限 256KB）", size: info.size };
      }
      const buffer = await readFile(path);
      if (looksBinary(buffer)) {
        return { path, name, ok: false, error: "暂不支持二进制文件", size: info.size };
      }
      return { path, name, ok: true, text: buffer.toString("utf8"), size: info.size };
    } catch (error) {
      return {
        path,
        name,
        ok: false,
        error: error instanceof Error ? error.message : "读取失败",
        size: 0
      };
    }
  });

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "程小帮",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 19, y: 19 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff",
    webPreferences: {
      preload: preloadPath(import.meta.url),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 右侧浏览器面板使用 webview，后续 attach 时会继续收紧权限。
      webviewTag: true
    }
  });

  mainWindow.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    // webview 会打开任意网页，不能给它 preload 或 Node 权限。
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    if (!shouldAllowWebviewSrc(params.src)) {
      console.warn(`[main] 拒绝 webview 加载不受信任地址 src=${params.src}`);
      event.preventDefault();
    }
  });

  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media");
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (openExternalFromAppWindow(url, "window-open")) {
      return { action: "deny" };
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (openExternalFromAppWindow(url, "will-navigate")) {
      event.preventDefault();
    }
  });

  // 渲染层问题同步到终端，避免白屏时只能手动打开 devtools 排查。
  mainWindow.webContents.on("console-message", (details) => {
    const level = rendererConsoleLevelFromElectron(details.level);
    logRendererConsole(desktopLogging?.renderer, {
      level,
      message: details.message,
      line: details.lineNumber,
      sourceId: details.sourceId
    });
    if (level >= 2) {
      writeTerminalLog(
        "error",
        `[renderer:${level === 3 ? "error" : "warn"}] ${details.message} (${details.sourceId}:${details.lineNumber})`
      );
    }
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    writeStructuredLog(
      desktopLogging?.renderer,
      "error",
      {
        reason: details.reason,
        exitCode: details.exitCode
      },
      "渲染进程崩溃"
    );
    writeTerminalLog("error", "[renderer] 渲染进程崩溃:", details.reason, details.exitCode);
  });
  mainWindow.webContents.on("did-fail-load", (_event, code, desc, url) => {
    writeStructuredLog(
      desktopLogging?.renderer,
      "error",
      {
        code,
        desc,
        url
      },
      "页面加载失败"
    );
    writeTerminalLog("error", `[renderer] 页面加载失败 ${code} ${desc} ${url}`);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(rendererIndexPath(import.meta.url));
  }
}

// 浏览器面板里的弹窗交给系统浏览器，不在应用内新开窗口。
app.on("web-contents-created", (_event, contents) => {
  if (contents.getType() === "webview") {
    contents.setWindowOpenHandler(({ url }) => {
      if (isHttpUrl(url)) {
        console.info(`[main] webview 弹窗转交系统浏览器 url=${url}`);
        void shell.openExternal(url);
      }
      return { action: "deny" };
    });
  }
});

// 打包产物会自动使用 .icns；dev 跑的是裸 Electron，需要运行时设置 Dock 图标。
function applyDevDockIcon(): void {
  if (app.isPackaged || process.platform !== "darwin") {
    return;
  }
  const icon = nativeImage.createFromPath(devDockIconPath(app.getAppPath()));
  if (!icon.isEmpty()) {
    app.dock?.setIcon(icon);
  }
}

app.whenReady().then(() => {
  applyDevDockIcon();
  return createWindow();
}).catch((error) => {
  console.error("[main] 应用启动失败:", messageFromError(error));
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  terminalManager?.disposeAll();
  stopBackend("before-quit");
  void flushDesktopLogs();
});

function handleProcessSignal(signal: NodeJS.Signals): void {
  terminalManager?.disposeAll();
  stopBackend(signal);
  void flushDesktopLogs().finally(() => {
    app.quit();
    setTimeout(() => process.exit(0), 250).unref();
  });
}

process.on("SIGTERM", handleProcessSignal);
process.on("SIGINT", handleProcessSignal);

async function flushDesktopLogs(): Promise<void> {
  try {
    await desktopLogging?.flush();
  } catch (error) {
    writeTerminalLog("error", "[main] 日志 flush 失败:", error);
  }
}
