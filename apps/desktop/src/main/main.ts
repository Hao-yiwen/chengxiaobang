import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  shell,
  type BrowserWindowConstructorOptions
} from "electron";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  open as openFile,
  readFile,
  readdir,
  rm,
  stat
} from "node:fs/promises";
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
import { installApplicationMenu } from "./app-menu";
import { startBackendProcess, type BackendProcess } from "./backend-process";
import {
  DEFAULT_EXTERNAL_BROWSER_ID,
  detectInstalledExternalBrowsers,
  externalBrowserDefinitions,
  externalBrowserSearchDirs,
  isSupportedExternalUrl,
  openExternalUrlInBrowser as openUrlInExternalBrowser
} from "./browsers";
import {
  detectInstalledProjectOpeners,
  projectOpenerDefinitions,
  projectOpenerBundleIconFileNames,
  projectOpenerSearchDirs
} from "./ide";
import {
  initializeDesktopLogging,
  logRendererConsole,
  writeStructuredLog,
  writeTerminalLog
} from "./logging";
import {
  isHttpUrl,
  isTrustedAppWindowUrl,
  shouldAllowWebviewSrc,
  shouldOpenExternalFromAppWindow
} from "./navigation";
import {
  defaultDataDir,
  defaultLogDir,
  defaultProfilePath,
  defaultProviderConfigPath,
  devDockIconPath,
  preloadPath,
  rendererIndexPath
} from "./paths";
import {
  previewPathCandidates,
  type FilePreviewResolveContext
} from "./file-preview-path";
import { registerOcrIpc, startOcrHttpService, type OcrHttpService } from "./ocr";
import { registerTerminalIpc, type TerminalSessionManager } from "./terminal";
import { DesktopUpdateService, registerUpdateIpc, type DesktopUpdater } from "./update-service";
import { createTrustedIpcRegistrar } from "./trusted-ipc";
import { saveUserProfile } from "./profile";

const MAX_CONTEXT_FILE_BYTES = 256 * 1024;
const DEFAULT_BLANK_PROJECT_NAME = "未命名项目";
const desktopLogging = initializeDesktopLogging({ logDir: defaultLogDir() });

if (desktopLogging) {
  console.info(
    `[main] 日志写入目录 logDir=${desktopLogging.logDir} layout=YYYY-MM-DD/HH-HH/source.log level=${desktopLogging.level}`
  );
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

type DisplayAttachmentSnapshot = {
  id: string;
  name: string;
  kind: PreviewKind;
  mimeType?: string;
  size: number;
  path: string;
};

type SaveAttachmentSnapshotsResult =
  | {
      ok: true;
      attachments: DisplayAttachmentSnapshot[];
      totalBytes: number;
      elapsedMs: number;
    }
  | { ok: false; error: string };

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
    ...(typeof input.sessionId === "string" && input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(typeof (input as { allowCwdFallback?: unknown }).allowCwdFallback === "boolean"
      ? { allowCwdFallback: (input as { allowCwdFallback: boolean }).allowCwdFallback }
      : {})
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
let ocrHttpService: OcrHttpService | undefined;
const projectOpenerIconCache = new Map<string, string | undefined>();
let terminalManager: TerminalSessionManager | undefined;
let updateService: DesktopUpdateService | undefined;

function isDevDesktopRuntime(): boolean {
  return !app.isPackaged;
}

function stopBackend(reason: string): void {
  if (!backend) {
    return;
  }
  console.info(`[main] 停止后端 reason=${reason}`);
  backend.stop();
  backend = undefined;
}

function stopOcrHttpService(reason: string): void {
  if (!ocrHttpService) {
    return;
  }
  console.info(`[main] 停止 OCR 本地服务 reason=${reason}`);
  const service = ocrHttpService;
  ocrHttpService = undefined;
  void service.close().catch((error) => {
    console.warn(`[main] OCR 本地服务关闭失败 reason=${reason}: ${messageFromError(error)}`);
  });
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

function requestNewChatFromMenu(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    console.warn("[main] 应用菜单请求新建对话时主窗口不可用");
    return;
  }
  console.info("[main] 应用菜单请求新建对话，转发到渲染层");
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send("app-menu:new-chat");
}

function openMainWindowDevTools(reason: string): { ok: boolean; error?: string } {
  if (!isDevDesktopRuntime()) {
    return { ok: false, error: "DevTools 入口仅在开发环境可用" };
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    console.warn(`[main] 打开 DevTools 失败 reason=${reason}: 主窗口不可用`);
    return { ok: false, error: "主窗口不可用" };
  }
  try {
    mainWindow.webContents.openDevTools({ mode: "detach", activate: true });
    console.info(`[main] 已打开 DevTools reason=${reason}`);
    return { ok: true };
  } catch (error) {
    const message = messageFromError(error);
    console.error(`[main] 打开 DevTools 失败 reason=${reason}: ${message}`);
    return { ok: false, error: message };
  }
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface AutoUpdaterLoadResult {
  updater?: DesktopUpdater;
  disabledReason?: string;
}

async function loadAutoUpdater(): Promise<AutoUpdaterLoadResult> {
  if (!app.isPackaged || process.platform !== "darwin") {
    return {};
  }
  try {
    const updaterModule = await import("electron-updater");
    const defaultExport = updaterModule.default as { autoUpdater?: DesktopUpdater } | undefined;
    const namedExport = updaterModule as { autoUpdater?: DesktopUpdater };
    const updater = defaultExport?.autoUpdater ?? namedExport.autoUpdater;
    if (!updater) {
      const disabledReason = "自动更新模块没有导出 autoUpdater，已暂时禁用自动更新";
      console.warn("[main] 自动更新模块已加载，但没有导出 autoUpdater，已禁用自动更新", {
        platform: process.platform,
        isPackaged: app.isPackaged
      });
      return { disabledReason };
    }
    return { updater };
  } catch (error) {
    const disabledReason = `自动更新模块加载失败，已暂时禁用自动更新：${messageFromError(error)}`;
    console.error("[main] 自动更新模块加载失败，已禁用自动更新", {
      platform: process.platform,
      isPackaged: app.isPackaged,
      error: messageFromError(error)
    });
    return { disabledReason };
  }
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

async function saveAttachmentSnapshots(target: unknown): Promise<SaveAttachmentSnapshotsResult> {
  const paths = Array.isArray(target)
    ? target.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
  if (!Array.isArray(target)) {
    console.warn("[main] 附件快照请求收到无效参数");
    return { ok: false, error: "无效附件列表" };
  }
  const startedAt = Date.now();
  try {
    console.info("[main] 开始保存附件快照", {
      count: paths.length,
      dataDir: defaultDataDir()
    });
    const attachments: DisplayAttachmentSnapshot[] = [];
    for (const path of paths) {
      attachments.push(await saveOneAttachmentSnapshot(path));
    }
    const totalBytes = attachments.reduce((total, attachment) => total + attachment.size, 0);
    const elapsedMs = Date.now() - startedAt;
    console.info("[main] 附件快照保存完成", {
      count: attachments.length,
      totalBytes,
      elapsedMs
    });
    return { ok: true, attachments, totalBytes, elapsedMs };
  } catch (error) {
    const message = messageFromError(error);
    console.warn("[main] 附件快照保存失败", {
      count: paths.length,
      elapsedMs: Date.now() - startedAt,
      error: message
    });
    return { ok: false, error: message };
  }
}

async function saveOneAttachmentSnapshot(sourcePath: string): Promise<DisplayAttachmentSnapshot> {
  const info = await stat(sourcePath);
  if (!info.isFile()) {
    throw new Error(`不是可复制的文件：${sourcePath}`);
  }
  const id = `attachment_${randomUUID().replace(/-/g, "")}`;
  const name = basename(sourcePath);
  const kind = previewDescriptorForPath(sourcePath).kind;
  const targetDir = join(defaultDataDir(), "attachments");
  await mkdir(targetDir, { recursive: true });
  const targetPath = join(targetDir, `${id}-${sanitizeSnapshotFileName(name)}`);
  await copyFile(sourcePath, targetPath);
  console.info("[main] 附件快照已复制", {
    id,
    sourcePath,
    targetPath,
    kind,
    size: info.size
  });
  const mimeType = mimeTypeForPath(sourcePath);
  return {
    id,
    name,
    kind,
    ...(mimeType ? { mimeType } : {}),
    size: info.size,
    path: targetPath
  };
}

function sanitizeSnapshotFileName(name: string): string {
  const sanitized = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .trim();
  return (sanitized || "attachment").slice(0, 160);
}

function mimeTypeForPath(path: string): string | undefined {
  switch (extensionOf(path)) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "bmp":
      return "image/bmp";
    case "avif":
      return "image/avif";
    case "heic":
      return "image/heic";
    case "pdf":
      return "application/pdf";
    default:
      return undefined;
  }
}

async function createQuickLookThumbnail(target: unknown): Promise<QuickLookThumbnailResult> {
  const path = typeof target === "string" ? target : "";
  if (!path) {
    console.warn("[main] Quick Look 缩略图请求收到无效路径");
    return { ok: false, path, error: "无效路径" };
  }
  if (process.platform !== "darwin") {
    console.info(`[main] 当前平台跳过 Quick Look 缩略图 path=${path} platform=${process.platform}`);
    return { ok: false, path, error: "当前平台暂不支持系统缩略图" };
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
  const autoUpdaterLoad = await loadAutoUpdater();
  updateService ??= new DesktopUpdateService({
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    updater: autoUpdaterLoad.updater,
    ...(autoUpdaterLoad.disabledReason
      ? { updaterUnavailableReason: autoUpdaterLoad.disabledReason }
      : {})
  });
  installApplicationMenu({
    appName: app.getName(),
    platform: process.platform,
    updateService,
    requestNewChat: requestNewChatFromMenu
  });

  const ocrOptions = {
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged
  };
  ocrHttpService ??= await startOcrHttpService(ocrOptions);
  backend = await startBackendProcess({
    dataDir: defaultDataDir(),
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged,
    ocrService: { url: ocrHttpService.url, token: ocrHttpService.token },
    logger: desktopLogging?.backend
  });

  const trustedIpc = createTrustedIpcRegistrar(ipcMain, {
    devServerUrl: process.env.VITE_DEV_SERVER_URL,
    rendererFilePath: rendererIndexPath(import.meta.url)
  });

  trustedIpc.handle("backend-info", () => backend?.info);
  terminalManager ??= registerTerminalIpc(trustedIpc);
  registerOcrIpc(trustedIpc, ocrOptions);
  registerUpdateIpc(trustedIpc, updateService);

  trustedIpc.handle("open-devtools", () => openMainWindowDevTools("renderer-floating-button"));

  trustedIpc.handle("open-skills-dir", async () => {
    const dir = join(homedir(), ".chengxiaobang", "skills");
    await mkdir(dir, { recursive: true });
    await shell.openPath(dir);
    return { ok: true, path: dir };
  });

  trustedIpc.handle("open-log-dir", async () => {
    const dir = defaultLogDir();
    await mkdir(dir, { recursive: true });
    const error = await shell.openPath(dir);
    if (error) {
      console.warn(`[main] 打开日志目录失败 path=${dir}: ${error}`);
      return { ok: false, path: dir, error };
    }
    console.info(`[main] 已打开日志目录 path=${dir}`);
    return { ok: true, path: dir };
  });

  trustedIpc.handle("open-provider-config", async () => {
    const target = defaultProviderConfigPath();
    const error = await shell.openPath(target);
    if (error) {
      console.error("[main] 打开供应商 config.yaml 失败", { target, error });
      return { ok: false, path: target, error };
    }
    console.info("[main] 已打开供应商 config.yaml", { target });
    return { ok: true, path: target };
  });

  trustedIpc.handle("profile:save", async (_event, input: unknown) => {
    const target = defaultProfilePath();
    const result = await saveUserProfile(input, { profilePath: target });
    if (result.ok) {
      console.info("[main] 用户画像已写入 profile.json", {
        path: result.path,
        primaryUse: result.profile.onboardingProfile.primaryUse,
        scenarioCount: result.profile.onboardingProfile.scenarios.length
      });
      return result;
    }
    console.warn("[main] 用户画像写入 profile.json 失败", {
      path: result.path,
      error: result.error
    });
    return result;
  });

  trustedIpc.handle("create-project-folder", async (_event, rawName: unknown) => {
    const requested = typeof rawName === "string" ? rawName : "";
    console.info(`[main] 新建空白项目目录 请求 name=${JSON.stringify(requested)}`);
    // 清洗名字：去首尾空白、去掉路径分隔符与前导点，避免越权路径或隐藏目录
    const sanitized = requested
      .trim()
      .replace(/[/\\]/g, "")
      .replace(/^\.+/, "")
      .trim();
    const base = sanitized.length > 0 ? sanitized : DEFAULT_BLANK_PROJECT_NAME;
    const documentsDir = app.getPath("documents");
    try {
      await mkdir(documentsDir, { recursive: true });
      // 去重：同名存在则追加 -2、-3…
      let name = base;
      let target = join(documentsDir, name);
      let suffix = 2;
      while (existsSync(target)) {
        name = `${base}-${suffix}`;
        target = join(documentsDir, name);
        suffix += 1;
      }
      await mkdir(target, { recursive: true });
      console.info(`[main] 新建空白项目目录 成功 path=${target}`);
      return { ok: true, path: target, name };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[main] 新建空白项目目录 失败 name=${base}: ${message}`);
      return { ok: false, error: message };
    }
  });

  // 在用户默认应用中打开生成的文件产物（pptx/docx/xlsx 等）。
  trustedIpc.handle("open-path", async (_event, target: unknown) => {
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

  trustedIpc.handle("file-preview:info", (_event, target: unknown, context: unknown) =>
    filePreviewInfo(target, context)
  );
  trustedIpc.handle("file-preview:read-text", (_event, target: unknown, options: unknown) =>
    readFilePreviewText(target, options)
  );
  trustedIpc.handle("file-preview:read-buffer", (_event, target: unknown, options: unknown) =>
    readFilePreviewBuffer(target, options)
  );
  trustedIpc.handle("file-preview:file-url", (_event, target: unknown) => createPreviewFileUrl(target));
  trustedIpc.handle("file-preview:quicklook-thumbnail", (_event, target: unknown) =>
    createQuickLookThumbnail(target)
  );
  trustedIpc.handle("attachment:save-snapshots", (_event, target: unknown) =>
    saveAttachmentSnapshots(target)
  );

  trustedIpc.handle("detect-project-openers", async () => {
    const loadIconDataUrl = process.platform === "darwin" ? loadProjectOpenerIconDataUrl : undefined;
    const openers = await detectInstalledProjectOpeners(
      projectOpenerSearchDirs(homedir(), process.platform, process.env),
      existsSync,
      loadIconDataUrl,
      projectOpenerDefinitions(process.platform, process.env)
    );
    console.info(`[main] 项目打开器检测完成 count=${openers.length}`);
    return openers;
  });

  trustedIpc.handle("detect-external-browsers", async () => {
    const browsers = await detectInstalledExternalBrowsers(
      externalBrowserSearchDirs(homedir(), process.platform),
      existsSync,
      externalBrowserDefinitions(process.platform, process.env)
    );
    console.info(`[main] 外部浏览器检测完成 count=${browsers.length}`);
    return browsers;
  });

  trustedIpc.handle(
    "open-external-url-in-browser",
    async (_event, browserIdOrPath: unknown, targetUrl: unknown) => {
      if (typeof browserIdOrPath !== "string" || typeof targetUrl !== "string") {
        console.warn("[main] 指定浏览器打开链接收到无效参数", {
          browserIdOrPath: String(browserIdOrPath),
          targetUrl: String(targetUrl)
        });
        return { ok: false, error: "无效参数" };
      }
      if (!isSupportedExternalUrl(targetUrl)) {
        console.warn("[main] 拒绝用浏览器打开非 HTTP(S) 链接", {
          browserIdOrPath,
          targetUrl
        });
        return { ok: false, error: "只支持打开 HTTP(S) 链接" };
      }

      console.info("[main] 准备用指定浏览器打开外链", {
        browserIdOrPath,
        targetUrl
      });
      const result = await openUrlInExternalBrowser(browserIdOrPath, targetUrl, {
        platform: process.platform,
        env: process.env,
        home: homedir(),
        exists: existsSync,
        execFile: (command, args, callback) => {
          execFile(command, args, callback);
        },
        openDefault: (url) => shell.openExternal(url)
      });

      if (result.ok) {
        console.info("[main] 指定浏览器打开外链成功", {
          browserIdOrPath,
          browserKind:
            browserIdOrPath === DEFAULT_EXTERNAL_BROWSER_ID ? DEFAULT_EXTERNAL_BROWSER_ID : "detected",
          targetUrl
        });
      } else {
        console.warn("[main] 指定浏览器打开外链失败", {
          browserIdOrPath,
          targetUrl,
          error: result.error
        });
      }
      return result;
    }
  );

  // 使用已安装的本机应用打开项目目录。
  trustedIpc.handle("open-project-in-app", async (_event, appPath: unknown, target: unknown) => {
    if (typeof appPath !== "string" || typeof target !== "string" || target.length === 0) {
      console.error(
        `[main] 项目打开器收到无效参数 appPath=${String(appPath)} target=${String(target)}`
      );
      return { ok: false, error: "无效参数" };
    }
    const installed = await detectInstalledProjectOpeners(
      projectOpenerSearchDirs(homedir(), process.platform, process.env),
      existsSync,
      undefined,
      projectOpenerDefinitions(process.platform, process.env)
    );
    if (!installed.some((opener) => opener.appPath === appPath)) {
      console.error(`[main] 拒绝打开未知项目打开器 appPath=${appPath} target=${target}`);
      return { ok: false, error: "未知项目打开器" };
    }
    return new Promise((resolve) => {
      const command = process.platform === "win32" ? appPath : "open";
      const args = process.platform === "win32" ? [target] : ["-a", appPath, target];
      execFile(command, args, (error) => {
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

  trustedIpc.handle("set-theme-source", (_event, source: unknown) => {
    if (source === "light" || source === "dark" || source === "system") {
      nativeTheme.themeSource = source;
    }
  });

  trustedIpc.handle("pick-directory", async () => {
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

  trustedIpc.handle("pick-files", async () => {
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

  trustedIpc.handle("read-file-text", async (_event, filePath: unknown): Promise<ReadFileResult> => {
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

  const windowOptions: BrowserWindowConstructorOptions = {
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "程小帮",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff",
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 19, y: 19 }
        }
      : {}),
    webPreferences: {
      preload: preloadPath(import.meta.url),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: isDevDesktopRuntime(),
      // 右侧浏览器面板使用 webview，后续 attach 时会继续收紧权限。
      webviewTag: true
    }
  };
  mainWindow = new BrowserWindow(windowOptions);
  if (isDevDesktopRuntime()) {
    openMainWindowDevTools("window-created");
    mainWindow.webContents.once("did-finish-load", () => {
      if (!mainWindow?.webContents.isDevToolsOpened()) {
        openMainWindowDevTools("did-finish-load");
      }
    });
  }

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
    const allowed = permission === "media" || permission === "notifications";
    console.info("[main] 权限申请", { permission, allowed });
    callback(allowed);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (openExternalFromAppWindow(url, "window-open")) {
      return { action: "deny" };
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const trusted = isTrustedAppWindowUrl(url, {
      devServerUrl: process.env.VITE_DEV_SERVER_URL,
      rendererFilePath: rendererIndexPath(import.meta.url)
    });
    if (trusted) {
      return;
    }
    event.preventDefault();
    if (openExternalFromAppWindow(url, "will-navigate")) {
      return;
    }
    console.warn("[main] 已阻止主窗口导航到不受信任地址", {
      url
    });
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
  updateService.startAutoChecks();
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
  updateService?.stopAutoChecks();
  terminalManager?.disposeAll();
  stopBackend("before-quit");
  stopOcrHttpService("before-quit");
  void flushDesktopLogs();
});

app.on("will-quit", () => {
  updateService?.stopAutoChecks();
  terminalManager?.disposeAll();
  stopBackend("will-quit");
  stopOcrHttpService("will-quit");
  void flushDesktopLogs();
});

function handleProcessSignal(signal: NodeJS.Signals): void {
  updateService?.stopAutoChecks();
  terminalManager?.disposeAll();
  stopBackend(signal);
  stopOcrHttpService(signal);
  void flushDesktopLogs().finally(() => {
    app.quit();
    setTimeout(() => process.exit(0), 250).unref();
  });
}

process.on("SIGTERM", handleProcessSignal);
process.on("SIGINT", handleProcessSignal);
process.on("exit", () => {
  updateService?.stopAutoChecks();
  terminalManager?.disposeAll();
  stopBackend("process-exit");
});

async function flushDesktopLogs(): Promise<void> {
  try {
    await desktopLogging?.flush();
  } catch (error) {
    writeTerminalLog("error", "[main] 日志 flush 失败:", error);
  }
}
