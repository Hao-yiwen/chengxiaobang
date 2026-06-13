import { join } from "node:path";

export interface ProjectOpenerDefinition {
  id: string;
  name: string;
  /** 候选 .app 包名，按偏好顺序排列，例如优先正式版，再回退 CE 版。 */
  appNames?: string[];
  /** macOS 系统应用等固定路径，不随用户 Applications 目录变化。 */
  absoluteAppPaths?: string[];
}

export interface InstalledProjectOpener {
  id: string;
  name: string;
  appPath: string;
  iconDataUrl?: string;
}

export const PROJECT_OPENER_DEFINITIONS: ProjectOpenerDefinition[] = [
  { id: "vscode", name: "VS Code", appNames: ["Visual Studio Code.app"] },
  { id: "cursor", name: "Cursor", appNames: ["Cursor.app"] },
  { id: "zed", name: "Zed", appNames: ["Zed.app"] },
  { id: "windsurf", name: "Windsurf", appNames: ["Windsurf.app"] },
  { id: "antigravity", name: "Antigravity", appNames: ["Antigravity.app"] },
  { id: "codex", name: "Codex", appNames: ["Codex.app"] },
  { id: "finder", name: "Finder", absoluteAppPaths: ["/System/Library/CoreServices/Finder.app"] },
  {
    id: "terminal",
    name: "Terminal",
    absoluteAppPaths: ["/System/Applications/Utilities/Terminal.app"]
  },
  { id: "iterm2", name: "iTerm2", appNames: ["iTerm.app", "iTerm2.app"] },
  { id: "ghostty", name: "Ghostty", appNames: ["Ghostty.app"] },
  { id: "warp", name: "Warp", appNames: ["Warp.app"] },
  { id: "xcode", name: "Xcode", appNames: ["Xcode.app"] },
  { id: "android-studio", name: "Android Studio", appNames: ["Android Studio.app"] },
  { id: "idea", name: "IntelliJ IDEA", appNames: ["IntelliJ IDEA.app", "IntelliJ IDEA CE.app"] },
  { id: "goland", name: "GoLand", appNames: ["GoLand.app"] },
  { id: "pycharm", name: "PyCharm", appNames: ["PyCharm.app", "PyCharm CE.app"] }
];

export function projectOpenerSearchDirs(home: string): string[] {
  return ["/Applications", join(home, "Applications")];
}

export function projectOpenerCandidatePaths(
  opener: ProjectOpenerDefinition,
  searchDirs: string[]
): string[] {
  return [
    ...(opener.absoluteAppPaths ?? []),
    ...(opener.appNames ?? []).flatMap((appName) => searchDirs.map((dir) => join(dir, appName)))
  ];
}

export function projectOpenerBundleIconFileNames(iconName: string): string[] {
  return iconName.endsWith(".icns") ? [iconName] : [`${iconName}.icns`, iconName];
}

/** 解析本机已安装的项目打开器；`exists` 和 `loadIconDataUrl` 注入以便单测。 */
export async function detectInstalledProjectOpeners(
  searchDirs: string[],
  exists: (path: string) => boolean,
  loadIconDataUrl: (
    appPath: string,
    opener: ProjectOpenerDefinition
  ) => string | undefined | Promise<string | undefined> = () => undefined
): Promise<InstalledProjectOpener[]> {
  const installed: InstalledProjectOpener[] = [];
  for (const opener of PROJECT_OPENER_DEFINITIONS) {
    const appPath = projectOpenerCandidatePaths(opener, searchDirs).find((candidate) =>
      exists(candidate)
    );
    if (appPath) {
      let iconDataUrl: string | undefined;
      try {
        iconDataUrl = await loadIconDataUrl(appPath, opener);
      } catch (error) {
        console.warn(
          `[project-openers] 图标读取失败，继续返回打开器 id=${opener.id} appPath=${appPath} error=${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
      installed.push({
        id: opener.id,
        name: opener.name,
        appPath,
        iconDataUrl
      });
    }
  }
  return installed;
}
