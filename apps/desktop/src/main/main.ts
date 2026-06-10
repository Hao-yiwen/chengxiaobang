import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from "electron";
import { mkdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
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

  ipcMain.handle("open-skills-dir", async () => {
    const dir = join(homedir(), ".chengxiaobang", "skills");
    await mkdir(dir, { recursive: true });
    await shell.openPath(dir);
    return { ok: true, path: dir };
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
      // Hosts the renderer's browser panel; attached webviews are hardened below.
      webviewTag: true
    }
  });

  mainWindow.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    // The webview shows arbitrary web pages: never give it a preload or node.
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    if (!isHttpUrl(params.src)) {
      event.preventDefault();
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

  if (process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(rendererIndexPath(import.meta.url));
  }
}

// Pop-ups from browser-panel webviews go to the system browser, never new windows.
app.on("web-contents-created", (_event, contents) => {
  if (contents.getType() === "webview") {
    contents.setWindowOpenHandler(({ url }) => {
      if (isHttpUrl(url)) {
        void shell.openExternal(url);
      }
      return { action: "deny" };
    });
  }
});

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
