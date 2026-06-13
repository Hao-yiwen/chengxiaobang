import { describe, expect, it, vi } from "vitest";
import type { MenuItemConstructorOptions } from "electron";
import { createApplicationMenuTemplate } from "../src/main/app-menu";

vi.mock("electron", () => ({
  Menu: {
    buildFromTemplate: vi.fn((template: MenuItemConstructorOptions[]) => template),
    setApplicationMenu: vi.fn()
  }
}));

function submenuItems(item: MenuItemConstructorOptions | undefined): MenuItemConstructorOptions[] {
  return item && Array.isArray(item.submenu) ? item.submenu : [];
}

describe("macOS application menu", () => {
  it("adds New Chat to File and renames Close Window to Close", () => {
    const requestNewChat = vi.fn();
    const template = createApplicationMenuTemplate({
      appName: "菲尔",
      platform: "darwin",
      updateService: { checkForUpdates: vi.fn(async () => undefined) },
      requestNewChat
    });

    const fileMenu = template.find((item) => item.label === "File");
    const items = submenuItems(fileMenu);
    const newChatItem = items.find((item) => item.label === "New Chat");
    const closeItem = items.find((item) => item.label === "Close");

    expect(newChatItem).toMatchObject({
      label: "New Chat",
      accelerator: "CommandOrControl+N"
    });
    expect(closeItem).toMatchObject({ label: "Close", role: "close" });

    newChatItem?.click?.({} as never, {} as never, {} as never);

    expect(requestNewChat).toHaveBeenCalledTimes(1);
  });
});

describe("Windows application menu", () => {
  it("keeps New Chat without adding the macOS update entry", () => {
    const requestNewChat = vi.fn();
    const template = createApplicationMenuTemplate({
      appName: "菲尔",
      platform: "win32",
      updateService: { checkForUpdates: vi.fn(async () => undefined) },
      requestNewChat
    });

    expect(template.find((item) => item.label === "菲尔")).toBeUndefined();
    expect(JSON.stringify(template)).not.toContain("检查更新");

    const fileMenu = template.find((item) => item.label === "File");
    const items = submenuItems(fileMenu);
    const newChatItem = items.find((item) => item.label === "New Chat");

    expect(newChatItem).toMatchObject({
      label: "New Chat",
      accelerator: "CommandOrControl+N"
    });
    expect(template.find((item) => item.label === "编辑")).toBeDefined();
    expect(template.find((item) => item.label === "显示")).toBeDefined();
    expect(template.find((item) => item.label === "窗口")).toBeDefined();

    newChatItem?.click?.({} as never, {} as never, {} as never);

    expect(requestNewChat).toHaveBeenCalledTimes(1);
  });
});
