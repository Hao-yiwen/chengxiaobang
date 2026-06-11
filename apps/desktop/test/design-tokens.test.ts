import { describe, expect, it } from "vitest";
import tailwindConfig from "../tailwind.config";

/**
 * DESIGN.md token contract: the Tailwind theme is the single place the spec's
 * radius ladder, type roles, palette names, and flat-shadow rule are encoded.
 * These assertions keep a future refactor from silently dropping them.
 */
describe("design tokens (DESIGN.md)", () => {
  const theme = tailwindConfig.theme;

  it("uses the spec radius ladder (4/8/16/22/30/32)", () => {
    expect(theme.borderRadius).toMatchObject({
      xs: "4px",
      sm: "8px",
      md: "16px",
      lg: "22px",
      xl: "30px",
      pill: "32px",
      full: "9999px"
    });
  });

  it("is flat: only none/overlay shadows exist", () => {
    expect(Object.keys(theme.boxShadow).sort()).toEqual(["none", "overlay"]);
  });

  it("exposes the spec accent and surface colors", () => {
    const colors = theme.extend.colors as Record<string, unknown>;
    for (const name of [
      "coral",
      "action-blue",
      "focus-blue",
      "form-focus",
      "deep-green",
      "dark-navy",
      "soft-stone",
      "pale-green",
      "pale-blue",
      "hairline",
      "muted-slate",
      "ink",
      "canvas"
    ]) {
      expect(colors[name], `missing color token: ${name}`).toBeDefined();
    }
    expect(colors.brand).toBeUndefined();
    expect(colors.amber).toBeUndefined();
  });

  it("defines the 12-role type ladder with the mono-label tracking", () => {
    const fontSize = theme.extend.fontSize as Record<string, [string, Record<string, string>]>;
    for (const role of [
      "hero",
      "display",
      "section-display",
      "section",
      "card-heading",
      "feature",
      "body-lg",
      "body",
      "button",
      "caption",
      "mono-label",
      "micro"
    ]) {
      expect(fontSize[role], `missing type role: ${role}`).toBeDefined();
    }
    expect(fontSize["mono-label"][1].letterSpacing).toBe("0.28px");
    expect(fontSize.body[0]).toBe("16px");
    expect(fontSize.hero[0]).toBe("96px");
  });

  it("splits display and body font stacks (Space Grotesk / Inter)", () => {
    const fontFamily = theme.extend.fontFamily as Record<string, string[]>;
    expect(fontFamily.display[0]).toBe("Space Grotesk");
    expect(fontFamily.sans[0]).toBe("Inter");
    expect(fontFamily.display).toContain("PingFang SC");
    expect(fontFamily.sans).toContain("PingFang SC");
  });
});
