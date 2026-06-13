import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { isTrustedAppWindowUrl } from "./navigation";

export type TrustedIpcHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

export interface TrustedIpcOptions {
  devServerUrl?: string;
  rendererFilePath?: string;
}

export interface TrustedIpcRegistrar {
  handle(channel: string, handler: TrustedIpcHandler): void;
}

export function createTrustedIpcRegistrar(
  ipcMain: IpcMain,
  options: TrustedIpcOptions
): TrustedIpcRegistrar {
  return {
    handle(channel, handler) {
      ipcMain.handle(channel, async (event, ...args) => {
        if (!event.senderFrame) {
          console.warn("[main] 拒绝缺少 senderFrame 的 IPC 调用", { channel });
          throw new Error("不受信任的页面不能调用本地能力");
        }
        const url = event.senderFrame.url;
        if (!isTrustedAppWindowUrl(url, options)) {
          console.warn("[main] 拒绝不受信任渲染来源的 IPC 调用", {
            channel,
            url
          });
          throw new Error("不受信任的页面不能调用本地能力");
        }
        return handler(event, ...args);
      });
    }
  };
}
