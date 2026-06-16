import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { shouldAllowAppPermissionRequest } from "../src/main/permissions";

describe("shouldAllowAppPermissionRequest", () => {
  it("allows clipboard writes only from the trusted main app window", () => {
    expect(
      shouldAllowAppPermissionRequest({
        permission: "clipboard-sanitized-write",
        requestingUrl: "http://127.0.0.1:5173/",
        isMainFrame: true,
        isMainWindow: true,
        trustedContext: { devServerUrl: "http://127.0.0.1:5173" }
      })
    ).toBe(true);
    expect(
      shouldAllowAppPermissionRequest({
        permission: "clipboard-sanitized-write",
        requestingUrl: "http://127.0.0.1:5173/",
        isMainFrame: true,
        isMainWindow: false,
        trustedContext: { devServerUrl: "http://127.0.0.1:5173" }
      })
    ).toBe(false);
    expect(
      shouldAllowAppPermissionRequest({
        permission: "clipboard-sanitized-write",
        requestingUrl: "http://127.0.0.1:5173/iframe.html",
        isMainFrame: false,
        isMainWindow: true,
        trustedContext: { devServerUrl: "http://127.0.0.1:5173" }
      })
    ).toBe(false);
  });

  it("allows packaged renderer clipboard writes", () => {
    const rendererPath = join(process.cwd(), "dist", "renderer", "index.html");

    expect(
      shouldAllowAppPermissionRequest({
        permission: "clipboard-sanitized-write",
        requestingUrl: `${pathToFileURL(rendererPath).href}#chat`,
        isMainFrame: true,
        isMainWindow: true,
        trustedContext: { rendererFilePath: rendererPath }
      })
    ).toBe(true);
  });

  it("keeps the existing media and notification permission behavior", () => {
    for (const permission of ["media", "notifications"]) {
      expect(
        shouldAllowAppPermissionRequest({
          permission,
          requestingUrl: "https://example.com/",
          isMainFrame: false,
          isMainWindow: false
        })
      ).toBe(true);
    }
  });

  it("rejects unrelated permissions", () => {
    expect(
      shouldAllowAppPermissionRequest({
        permission: "geolocation",
        requestingUrl: "http://127.0.0.1:5173/",
        isMainFrame: true,
        isMainWindow: true,
        trustedContext: { devServerUrl: "http://127.0.0.1:5173" }
      })
    ).toBe(false);
  });
});
