import { describe, expect, it } from "vitest";
import tailwindConfig from "../tailwind.config";

/**
 * DESIGN.md token 契约：Tailwind theme 是半径、字体层级、调色板和阴影的落地点。
 * 这些断言用来防止后续重构悄悄偏离 Vercel 主题。
 */
describe("design tokens (DESIGN.md)", () => {
  const theme = tailwindConfig.theme;

  it("uses the Vercel radius ladder (4/6/8/12/16/64/100)", () => {
    expect(theme.borderRadius).toMatchObject({
      xs: "4px",
      sm: "6px",
      md: "8px",
      lg: "12px",
      xl: "16px",
      "pill-sm": "64px",
      pill: "100px",
      full: "9999px"
    });
  });

  it("uses stacked Vercel elevation tokens", () => {
    expect(Object.keys(theme.boxShadow).sort()).toEqual([
      "float",
      "hairline",
      "modal",
      "none",
      "overlay",
      "stack",
      "subtle"
    ]);
  });

  it("exposes the Vercel surface, semantic, and gradient colors", () => {
    const colors = theme.extend.colors as Record<string, unknown>;
    for (const name of [
      "canvas",
      "canvas-soft",
      "canvas-soft-2",
      "ink",
      "body",
      "mute",
      "link",
      "link-deep",
      "link-bg-soft",
      "cyan",
      "highlight-pink",
      "violet",
      "success",
      "warning",
      "error-soft",
      "gradient-develop-start",
      "gradient-preview-end",
      "gradient-ship-end",
      "hairline",
      "line",
      "cinnabar",
      "moss",
      "ochre",
      "indigo"
    ]) {
      expect(colors[name], `missing color token: ${name}`).toBeDefined();
    }
    expect(colors.amber).toBeUndefined();
  });

  it("defines the Vercel type ladder and compatibility aliases", () => {
    const fontSize = theme.extend.fontSize as Record<string, [string, Record<string, string>]>;
    for (const role of [
      "display-xl",
      "display-lg",
      "display-md",
      "display-sm",
      "body-lg",
      "body-md",
      "body-sm",
      "body",
      "button",
      "button-lg",
      "caption",
      "mono-label",
      "code",
      "micro"
    ]) {
      expect(fontSize[role], `missing type role: ${role}`).toBeDefined();
    }
    expect(fontSize["display-xl"][1].letterSpacing).toBe("-2.4px");
    expect(fontSize["display-xl"][1].fontWeight).toBe("600");
    expect(fontSize["mono-label"][1].letterSpacing).toBeUndefined();
    expect(fontSize.body[0]).toBe("16px");
    expect(fontSize.hero[0]).toBe("48px");
  });

  it("uses the system sans stack for display and body", () => {
    const fontFamily = theme.extend.fontFamily as Record<string, string[]>;
    const systemSansStack = [
      "ui-sans-serif",
      "system-ui",
      "sans-serif",
      "Apple Color Emoji",
      "Segoe UI Emoji",
      "Segoe UI Symbol",
      "Noto Color Emoji"
    ];
    expect(fontFamily.display).toEqual(systemSansStack);
    expect(fontFamily.sans).toEqual(systemSansStack);
  });
});
