import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("chengxiaobang", {
  getBackendInfo: () => ipcRenderer.invoke("backend-info"),
  pickDirectory: () => ipcRenderer.invoke("pick-directory"),
  pickFiles: () => ipcRenderer.invoke("pick-files"),
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
  openPath: (filePath: string) => ipcRenderer.invoke("open-path", filePath),
  detectProjectOpeners: () => ipcRenderer.invoke("detect-project-openers"),
  openProjectInApp: (appPath: string, targetPath: string) =>
    ipcRenderer.invoke("open-project-in-app", appPath, targetPath),
  openSkillsDir: () => ipcRenderer.invoke("open-skills-dir"),
  setThemeSource: (source: "light" | "dark" | "system") =>
    ipcRenderer.invoke("set-theme-source", source),
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
  }
});
