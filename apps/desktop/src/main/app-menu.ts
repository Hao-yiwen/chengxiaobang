import { Menu, type MenuItemConstructorOptions } from "electron";
import { PRODUCT_NAME } from "@chengxiaobang/shared/product";

export interface ApplicationMenuUpdateService {
  checkForUpdates(options: { manual: boolean }): Promise<unknown>;
}

export interface ApplicationMenuOptions {
  appName: string;
  platform: NodeJS.Platform;
  updateService: ApplicationMenuUpdateService;
  requestNewChat(): void;
}

export function installApplicationMenu(options: ApplicationMenuOptions): void {
  if (options.platform !== "darwin" && options.platform !== "win32") {
    console.debug("[menu] 当前平台跳过应用菜单安装", { platform: options.platform });
    return;
  }
  console.info("[menu] 安装应用菜单", { platform: options.platform, appName: options.appName });
  Menu.setApplicationMenu(Menu.buildFromTemplate(createApplicationMenuTemplate(options)));
}

export function createApplicationMenuTemplate(
  options: ApplicationMenuOptions
): MenuItemConstructorOptions[] {
  if (options.platform === "win32") {
    return createWindowsApplicationMenuTemplate(options);
  }
  return createMacApplicationMenuTemplate(options);
}

function createMacApplicationMenuTemplate(options: ApplicationMenuOptions): MenuItemConstructorOptions[] {
  const appName = options.appName || PRODUCT_NAME;
  return [
    {
      label: appName,
      submenu: [
        { role: "about", label: `关于 ${appName}` },
        { type: "separator" },
        {
          label: "检查更新…",
          click: () => {
            console.info("[menu] 用户从 macOS 应用菜单手动检查更新");
            void options.updateService.checkForUpdates({ manual: true }).catch((error) => {
              console.error("[menu] macOS 应用菜单检查更新失败", {
                error: error instanceof Error ? error.message : String(error)
              });
            });
          }
        },
        { type: "separator" },
        { role: "services", label: "服务" },
        { type: "separator" },
        { role: "hide", label: `隐藏 ${appName}` },
        { role: "hideOthers", label: "隐藏其他" },
        { role: "unhide", label: "全部显示" },
        { type: "separator" },
        { role: "quit", label: `退出 ${appName}` }
      ]
    },
    {
      label: "File",
      submenu: [
        {
          label: "New Chat",
          accelerator: "CommandOrControl+N",
          click: () => {
            console.info("[menu] 用户从 File 菜单请求新建对话");
            options.requestNewChat();
          }
        },
        { type: "separator" },
        { role: "close", label: "Close" }
      ]
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" }
      ]
    },
    {
      label: "显示",
      submenu: [
        { role: "resetZoom", label: "实际大小" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "进入全屏" }
      ]
    },
    {
      label: "窗口",
      role: "windowMenu"
    }
  ];
}

function createWindowsApplicationMenuTemplate(
  options: ApplicationMenuOptions
): MenuItemConstructorOptions[] {
  return [
    {
      label: "File",
      submenu: [
        {
          label: "New Chat",
          accelerator: "CommandOrControl+N",
          click: () => {
            console.info("[menu] 用户从 Windows File 菜单请求新建对话");
            options.requestNewChat();
          }
        },
        { type: "separator" },
        { role: "quit", label: "Exit" }
      ]
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" }
      ]
    },
    {
      label: "显示",
      submenu: [
        { role: "resetZoom", label: "实际大小" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "进入全屏" }
      ]
    },
    {
      label: "窗口",
      role: "windowMenu"
    }
  ];
}
