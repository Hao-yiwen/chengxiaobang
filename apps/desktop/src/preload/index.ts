import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("chengxiaobang", {
  getBackendInfo: () => ipcRenderer.invoke("backend-info"),
  pickDirectory: () => ipcRenderer.invoke("pick-directory"),
  pickFiles: () => ipcRenderer.invoke("pick-files"),
  readFileText: (filePath: string) => ipcRenderer.invoke("read-file-text", filePath),
  openSkillsDir: () => ipcRenderer.invoke("open-skills-dir"),
  setThemeSource: (source: "light" | "dark" | "system") =>
    ipcRenderer.invoke("set-theme-source", source)
});
