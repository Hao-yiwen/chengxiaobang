import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  STARTUP_SPLASH_URL_PREFIX,
  createStartupSplashHtml,
  createStartupSplashUrl,
  loadStartupSplashImageDataUrl
} from "../src/main/startup-splash";

describe("startup splash", () => {
  it("renders a minimal light splash with the onboarding loading image centered", () => {
    const html = createStartupSplashHtml({
      dark: false,
      imageSrc: "data:image/png;base64,aW1hZ2U="
    });

    expect(html).toContain("background: #fafafa");
    expect(html).toContain('display: grid');
    expect(html).toContain("place-items: center");
    expect(html).toContain('class="startup-image"');
    expect(html).toContain("data:image/png;base64,aW1hZ2U=");
    expect(html).toContain('alt="程小帮"');
    expect(html).toContain("width: min(260px, 42vw, 40vh)");
    expect(html).toContain("height: auto");
    expect(html).not.toContain("启动中");
  });

  it("renders a dark splash without visible text when the icon is unavailable", () => {
    const html = createStartupSplashHtml({ dark: true });

    expect(html).toContain("background: #0a0a0a");
    expect(html).toContain("<body></body>");
    expect(html).toContain("script-src 'none'");
    expect(html).toContain("img-src data:");
  });

  it("encodes the startup splash as a data html url", () => {
    const url = createStartupSplashUrl({
      dark: false,
      imageSrc: "data:image/png;base64,aW1hZ2U="
    });
    const html = decodeURIComponent(url.slice(STARTUP_SPLASH_URL_PREFIX.length));

    expect(url.startsWith(STARTUP_SPLASH_URL_PREFIX)).toBe(true);
    expect(html).toContain('class="startup-image"');
    expect(html).toContain("data:image/png;base64,aW1hZ2U=");
  });

  it("loads the onboarding loading image as an inline data url", async () => {
    const dataUrl = await loadStartupSplashImageDataUrl(
      join(process.cwd(), "apps/desktop/assets/onboarding-loading.png")
    );

    expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("packages the compressed onboarding loading image with the desktop app", () => {
    const pkg = JSON.parse(
      readFileSync(join(process.cwd(), "apps/desktop/package.json"), "utf8")
    ) as { build?: { files?: string[] } };

    expect(pkg.build?.files).toContain("assets/onboarding-loading.png");
  });
});
