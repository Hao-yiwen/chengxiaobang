import { describe, expect, it, vi } from "vitest";
import type { IpcMain } from "electron";
import { createTrustedIpcRegistrar } from "../src/main/trusted-ipc";

describe("createTrustedIpcRegistrar", () => {
  it("allows trusted renderer frames and rejects untrusted frames", async () => {
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
        handlers.set(channel, handler);
      })
    } as unknown as IpcMain;
    const registrar = createTrustedIpcRegistrar(ipcMain, {
      devServerUrl: "http://127.0.0.1:5173"
    });

    registrar.handle("backend-info", () => ({ ok: true }));
    const handler = handlers.get("backend-info");
    expect(handler).toBeDefined();
    const invoke = handler!;

    await expect(
      invoke({ senderFrame: { url: "http://127.0.0.1:5173/" } })
    ).resolves.toEqual({ ok: true });
    await expect(
      invoke({ senderFrame: { url: "https://evil.example/" } })
    ).rejects.toThrow("不受信任");
  });
});
