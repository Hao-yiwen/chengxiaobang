import { contextBridge, ipcRenderer, webUtils } from "electron";

contextBridge.exposeInMainWorld("chengxiaobang", {
  platform: process.platform,
  getBackendInfo: () => ipcRenderer.invoke("backend-info"),
  pickDirectory: () => ipcRenderer.invoke("pick-directory"),
  pickFiles: () => ipcRenderer.invoke("pick-files"),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  readFileText: (filePath: string) => ipcRenderer.invoke("read-file-text", filePath),
  getFilePreviewInfo: (
    filePath: string,
    context?: { projectPath?: string; sessionId?: string }
  ) => ipcRenderer.invoke("file-preview:info", filePath, context),
  readFilePreviewText: (filePath: string, options?: { maxBytes?: number }) =>
    ipcRenderer.invoke("file-preview:read-text", filePath, options),
  readFilePreviewBuffer: (filePath: string, options?: { maxBytes?: number }) =>
    ipcRenderer.invoke("file-preview:read-buffer", filePath, options),
  createFileUrl: (filePath: string) => ipcRenderer.invoke("file-preview:file-url", filePath),
  createQuickLookThumbnail: (filePath: string) =>
    ipcRenderer.invoke("file-preview:quicklook-thumbnail", filePath),
  ocrRecognize: (filePath: string) => ipcRenderer.invoke("ocr:recognize", filePath),
  prepareNativeImages: (filePath: string) =>
    ipcRenderer.invoke("attachment:prepare-native-images", filePath),
  saveAttachmentSnapshots: (filePaths: string[]) =>
    ipcRenderer.invoke("attachment:save-snapshots", filePaths),
  openPath: (filePath: string) => ipcRenderer.invoke("open-path", filePath),
  detectProjectOpeners: () => ipcRenderer.invoke("detect-project-openers"),
  openProjectInApp: (appPath: string, targetPath: string) =>
    ipcRenderer.invoke("open-project-in-app", appPath, targetPath),
  createProjectFolder: (name: string) => ipcRenderer.invoke("create-project-folder", name),
  openSkillsDir: () => ipcRenderer.invoke("open-skills-dir"),
  openLogDir: () => ipcRenderer.invoke("open-log-dir"),
  openProviderConfig: () => ipcRenderer.invoke("open-provider-config"),
  saveProfile: (profile: unknown) => ipcRenderer.invoke("profile:save", profile),
  getUpdateState: () => ipcRenderer.invoke("update:get-state"),
  checkForUpdates: (input?: { manual?: boolean }) => ipcRenderer.invoke("update:check", input),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  setThemeSource: (source: "light" | "dark" | "system") =>
    ipcRenderer.invoke("set-theme-source", source),
  onNewChatRequested: (listener: () => void) => {
    const wrapped = () => {
      listener();
    };
    ipcRenderer.on("app-menu:new-chat", wrapped);
    return () => ipcRenderer.off("app-menu:new-chat", wrapped);
  },
  terminalStart: (input: { id: string; cwd: string; cols: number; rows: number }) =>
    ipcRenderer.invoke("terminal:start", input),
  terminalWrite: (id: string, data: string) => ipcRenderer.invoke("terminal:write", id, data),
  terminalResize: (id: string, cols: number, rows: number) =>
    ipcRenderer.invoke("terminal:resize", id, cols, rows),
  terminalClose: (id: string) => ipcRenderer.invoke("terminal:close", id),
  onTerminalData: (listener: (event: { id: string; data: string }) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: { id: string; data: string }) => {
      listener(payload);
    };
    ipcRenderer.on("terminal:data", wrapped);
    return () => ipcRenderer.off("terminal:data", wrapped);
  },
  onTerminalExit: (listener: (event: { id: string; exitCode: number }) => void) => {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      payload: { id: string; exitCode: number }
    ) => {
      listener(payload);
    };
    ipcRenderer.on("terminal:exit", wrapped);
    return () => ipcRenderer.off("terminal:exit", wrapped);
  },
  onUpdateState: (listener: (state: unknown) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      listener(payload);
    };
    ipcRenderer.on("update:state", wrapped);
    return () => ipcRenderer.off("update:state", wrapped);
  }
});
