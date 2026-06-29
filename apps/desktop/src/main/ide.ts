import { posix, win32 } from "node:path";

export interface ProjectOpenerDefinition {
  id: string;
  name: string;
  /** 候选 .app 包名，按偏好顺序排列，例如优先正式版，再回退 CE 版。 */
  appNames?: string[];
  /** 系统应用或 Windows 安装位置等固定路径，不随搜索目录变化。 */
  absoluteAppPaths?: string[];
  /** 系统内置打开器可以不依赖 exists 检测，例如 Windows Explorer。 */
  alwaysAvailable?: boolean;
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

export function projectOpenerDefinitions(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): ProjectOpenerDefinition[] {
  if (platform === "win32") {
    return windowsProjectOpenerDefinitions(env);
  }
  return PROJECT_OPENER_DEFINITIONS;
}

export function projectOpenerSearchDirs(
  home: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  if (platform === "win32") {
    return uniquePaths([
      env.LOCALAPPDATA ? win32.join(env.LOCALAPPDATA, "Programs") : undefined,
      env.ProgramFiles,
      env["ProgramFiles(x86)"]
    ]);
  }
  return ["/Applications", posix.join(home, "Applications")];
}

export function projectOpenerCandidatePaths(
  opener: ProjectOpenerDefinition,
  searchDirs: string[]
): string[] {
  return [
    ...(opener.absoluteAppPaths ?? []),
    ...(opener.appNames ?? []).flatMap((appName) =>
      searchDirs.map((dir) => joinLikeBase(dir, appName))
    )
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
  ,
  definitions: ProjectOpenerDefinition[] = PROJECT_OPENER_DEFINITIONS
): Promise<InstalledProjectOpener[]> {
  const installed: InstalledProjectOpener[] = [];
  for (const opener of definitions) {
    const candidates = projectOpenerCandidatePaths(opener, searchDirs);
    const appPath =
      candidates.find((candidate) => exists(candidate)) ??
      (opener.alwaysAvailable ? candidates[0] : undefined);
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

function windowsProjectOpenerDefinitions(env: NodeJS.ProcessEnv): ProjectOpenerDefinition[] {
  const localPrograms = env.LOCALAPPDATA ? win32.join(env.LOCALAPPDATA, "Programs") : undefined;
  const programFiles = env.ProgramFiles;
  const programFilesX86 = env["ProgramFiles(x86)"];
  const systemRoot = env.SystemRoot ?? "C:\\Windows";
  return [
    {
      id: "vscode",
      name: "VS Code",
      absoluteAppPaths: uniquePaths([
        localPrograms ? win32.join(localPrograms, "Microsoft VS Code", "Code.exe") : undefined,
        programFiles ? win32.join(programFiles, "Microsoft VS Code", "Code.exe") : undefined,
        programFilesX86 ? win32.join(programFilesX86, "Microsoft VS Code", "Code.exe") : undefined
      ])
    },
    {
      id: "cursor",
      name: "Cursor",
      absoluteAppPaths: uniquePaths([
        localPrograms ? win32.join(localPrograms, "Cursor", "Cursor.exe") : undefined,
        programFiles ? win32.join(programFiles, "Cursor", "Cursor.exe") : undefined
      ])
    },
    {
      id: "windsurf",
      name: "Windsurf",
      absoluteAppPaths: uniquePaths([
        localPrograms ? win32.join(localPrograms, "Windsurf", "Windsurf.exe") : undefined,
        programFiles ? win32.join(programFiles, "Windsurf", "Windsurf.exe") : undefined
      ])
    },
    {
      id: "explorer",
      name: "Explorer",
      absoluteAppPaths: uniquePaths([win32.join(systemRoot, "explorer.exe"), "explorer.exe"]),
      alwaysAvailable: true
    }
  ];
}

function uniquePaths(paths: Array<string | undefined>): string[] {
  return [...new Set(paths.filter((path): path is string => Boolean(path)))];
}

function joinLikeBase(basePath: string, childPath: string): string {
  return /^[A-Za-z]:[\\/]/.test(basePath) || basePath.startsWith("\\")
    ? win32.join(basePath, childPath)
    : posix.join(basePath, childPath);
}
