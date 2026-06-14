import { join } from "node:path";

export const DEFAULT_EXTERNAL_BROWSER_ID = "default";

export interface ExternalBrowserDefinition {
  id: string;
  name: string;
  appNames?: string[];
  absoluteAppPaths?: string[];
}

export interface InstalledExternalBrowser {
  id: string;
  name: string;
  appPath: string;
}

export interface OpenExternalUrlOptions {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  exists: (path: string) => boolean;
  execFile: (
    command: string,
    args: string[],
    callback: (error: Error | null) => void
  ) => void;
  openDefault: (url: string) => Promise<void> | void;
}

export function isSupportedExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function externalBrowserDefinitions(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): ExternalBrowserDefinition[] {
  if (platform === "win32") {
    return windowsExternalBrowserDefinitions(env);
  }
  return [
    { id: "safari", name: "Safari", appNames: ["Safari.app"] },
    { id: "chrome", name: "Google Chrome", appNames: ["Google Chrome.app"] },
    { id: "edge", name: "Microsoft Edge", appNames: ["Microsoft Edge.app"] },
    { id: "firefox", name: "Firefox", appNames: ["Firefox.app"] },
    { id: "brave", name: "Brave", appNames: ["Brave Browser.app"] },
    { id: "arc", name: "Arc", appNames: ["Arc.app"] }
  ];
}

export function externalBrowserSearchDirs(home: string, platform: NodeJS.Platform): string[] {
  if (platform === "win32") {
    return [];
  }
  return ["/Applications", join(home, "Applications")];
}

export function externalBrowserCandidatePaths(
  browser: ExternalBrowserDefinition,
  searchDirs: string[]
): string[] {
  return [
    ...(browser.absoluteAppPaths ?? []),
    ...(browser.appNames ?? []).flatMap((appName) => searchDirs.map((dir) => join(dir, appName)))
  ];
}

export async function detectInstalledExternalBrowsers(
  searchDirs: string[],
  exists: (path: string) => boolean,
  definitions: ExternalBrowserDefinition[] = externalBrowserDefinitions()
): Promise<InstalledExternalBrowser[]> {
  const installed: InstalledExternalBrowser[] = [];
  for (const browser of definitions) {
    const appPath = externalBrowserCandidatePaths(browser, searchDirs).find((candidate) =>
      exists(candidate)
    );
    if (appPath) {
      installed.push({
        id: browser.id,
        name: browser.name,
        appPath
      });
    }
  }
  return installed;
}

export async function openExternalUrlInBrowser(
  browserIdOrPath: string,
  url: string,
  options: OpenExternalUrlOptions
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupportedExternalUrl(url)) {
    return { ok: false, error: "只支持打开 HTTP(S) 链接" };
  }

  if (browserIdOrPath === DEFAULT_EXTERNAL_BROWSER_ID) {
    try {
      await options.openDefault(url);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  const installed = await detectInstalledExternalBrowsers(
    externalBrowserSearchDirs(options.home, options.platform),
    options.exists,
    externalBrowserDefinitions(options.platform, options.env)
  );
  const browser = installed.find(
    (candidate) => candidate.id === browserIdOrPath || candidate.appPath === browserIdOrPath
  );
  if (!browser) {
    return { ok: false, error: "未知浏览器" };
  }

  const { command, args } = externalBrowserLaunchCommand(browser.appPath, url, options.platform);
  return new Promise((resolve) => {
    options.execFile(command, args, (error) => {
      if (error) {
        resolve({ ok: false, error: error.message });
        return;
      }
      resolve({ ok: true });
    });
  });
}

export function externalBrowserLaunchCommand(
  appPath: string,
  url: string,
  platform: NodeJS.Platform
): { command: string; args: string[] } {
  if (platform === "win32") {
    return { command: appPath, args: [url] };
  }
  return { command: "open", args: ["-a", appPath, url] };
}

function windowsExternalBrowserDefinitions(env: NodeJS.ProcessEnv): ExternalBrowserDefinition[] {
  const localAppData = env.LOCALAPPDATA;
  const programFiles = env.ProgramFiles;
  const programFilesX86 = env["ProgramFiles(x86)"];
  return [
    {
      id: "chrome",
      name: "Google Chrome",
      absoluteAppPaths: uniquePaths([
        localAppData ? join(localAppData, "Google", "Chrome", "Application", "chrome.exe") : undefined,
        programFiles ? join(programFiles, "Google", "Chrome", "Application", "chrome.exe") : undefined,
        programFilesX86
          ? join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe")
          : undefined
      ])
    },
    {
      id: "edge",
      name: "Microsoft Edge",
      absoluteAppPaths: uniquePaths([
        localAppData
          ? join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe")
          : undefined,
        programFiles ? join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe") : undefined,
        programFilesX86
          ? join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe")
          : undefined
      ])
    },
    {
      id: "firefox",
      name: "Firefox",
      absoluteAppPaths: uniquePaths([
        programFiles ? join(programFiles, "Mozilla Firefox", "firefox.exe") : undefined,
        programFilesX86 ? join(programFilesX86, "Mozilla Firefox", "firefox.exe") : undefined
      ])
    },
    {
      id: "brave",
      name: "Brave",
      absoluteAppPaths: uniquePaths([
        localAppData
          ? join(localAppData, "BraveSoftware", "Brave-Browser", "Application", "brave.exe")
          : undefined,
        programFiles
          ? join(programFiles, "BraveSoftware", "Brave-Browser", "Application", "brave.exe")
          : undefined
      ])
    },
    {
      id: "ie",
      name: "Internet Explorer",
      absoluteAppPaths: uniquePaths([
        programFiles ? join(programFiles, "Internet Explorer", "iexplore.exe") : undefined,
        programFilesX86 ? join(programFilesX86, "Internet Explorer", "iexplore.exe") : undefined
      ])
    }
  ];
}

function uniquePaths(paths: Array<string | undefined>): string[] {
  return [...new Set(paths.filter((path): path is string => Boolean(path)))];
}
