import { extname } from "node:path";
import { fileURLToPath } from "node:url";

export interface ExternalNavigationContext {
  currentUrl?: string;
  devServerUrl?: string;
}

export function isHttpUrl(url: string): boolean {
  return url.startsWith("https://") || url.startsWith("http://");
}

export function localPathFromFileUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "file:" || parsed.host) {
      return undefined;
    }
    return fileURLToPath(parsed);
  } catch {
    return undefined;
  }
}

export function isLocalPreviewFileUrl(url: string): boolean {
  const path = localPathFromFileUrl(url);
  if (!path) {
    return false;
  }
  const ext = extname(path).toLowerCase();
  return ext === ".html" || ext === ".htm" || ext === ".svg";
}

export function shouldAllowWebviewSrc(url: string): boolean {
  return isHttpUrl(url) || isLocalPreviewFileUrl(url);
}

export function shouldOpenExternalFromAppWindow(
  url: string,
  context: ExternalNavigationContext = {}
): boolean {
  if (!isHttpUrl(url)) {
    return false;
  }
  const targetOrigin = originOf(url);
  if (!targetOrigin) {
    return false;
  }
  // dev 下 renderer 自己就是 http://127.0.0.1:5173，full reload/HMR 不应被当成外链。
  if (sameOrigin(targetOrigin, context.devServerUrl)) {
    return false;
  }
  // 同源主窗口导航属于应用内部导航，不要弹到系统浏览器。
  if (sameOrigin(targetOrigin, context.currentUrl)) {
    return false;
  }
  return true;
}

function sameOrigin(origin: string, candidateUrl?: string): boolean {
  return Boolean(candidateUrl && originOf(candidateUrl) === origin);
}

function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}
