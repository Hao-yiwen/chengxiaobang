import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from "electron";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { startBackendProcess, type BackendProcess } from "./backend-process";
import { defaultDataDir, preloadPath, rendererIndexPath } from "./paths";

const MAX_CONTEXT_FILE_BYTES = 256 * 1024;

type ReadFileResult =
  | { path: string; name: string; ok: true; text: string; size: number }
  | { path: string; name: string; ok: false; error: string; size: number };

function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8192);
  for (const byte of sample) {
    if (byte === 0) {
      return true;
    }
  }
  return false;
}

let mainWindow: BrowserWindow | undefined;
let backend: BackendProcess | undefined;

async function createWindow(): Promise<void> {
  backend = await startBackendProcess({
    dataDir: defaultDataDir(),
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged
  });

  ipcMain.handle("backend-info", () => backend?.info);

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
      sandbox: true
    }
  });

  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media");
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isHttpUrl(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  // Surface renderer problems in the terminal — a blank window is otherwise
  // undebuggable without opening devtools by hand.
  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level >= 2) {
      console.error(`[renderer:${level === 3 ? "error" : "warn"}] ${message} (${sourceId}:${line})`);
    }
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("[renderer] 渲染进程崩溃:", details.reason, details.exitCode);
  });
  mainWindow.webContents.on("did-fail-load", (_event, code, desc, url) => {
    console.error(`[renderer] 页面加载失败 ${code} ${desc} ${url}`);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(rendererIndexPath(import.meta.url));
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  backend?.stop();
});

function isHttpUrl(url: string): boolean {
  return url.startsWith("https://") || url.startsWith("http://");
}
