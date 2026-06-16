import { basename } from "node:path";
import { isTrustedAppWindowUrl, type TrustedAppWindowContext } from "./navigation";

const ALWAYS_ALLOWED_PERMISSIONS = new Set(["media", "notifications"]);
const TRUSTED_MAIN_WINDOW_PERMISSIONS = new Set(["clipboard-sanitized-write"]);

export interface AppPermissionRequest {
  permission: string;
  requestingUrl?: string;
  isMainFrame?: boolean;
  isMainWindow?: boolean;
  trustedContext?: TrustedAppWindowContext;
}

export function shouldAllowAppPermissionRequest(request: AppPermissionRequest): boolean {
  if (ALWAYS_ALLOWED_PERMISSIONS.has(request.permission)) {
    return true;
  }
  if (!TRUSTED_MAIN_WINDOW_PERMISSIONS.has(request.permission)) {
    return false;
  }
  return Boolean(
    request.isMainWindow &&
      request.isMainFrame &&
      request.requestingUrl &&
      isTrustedAppWindowUrl(request.requestingUrl, request.trustedContext)
  );
}

export function permissionRequestSourceSummary(request: AppPermissionRequest) {
  return {
    isMainWindow: Boolean(request.isMainWindow),
    isMainFrame: Boolean(request.isMainFrame),
    requestingUrl: summarizePermissionUrl(request.requestingUrl)
  };
}

function summarizePermissionUrl(url?: string): string {
  if (!url) {
    return "";
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:") {
      return `file://.../${basename(decodeURIComponent(parsed.pathname))}`;
    }
    return parsed.origin;
  } catch {
    return url.slice(0, 120);
  }
}
