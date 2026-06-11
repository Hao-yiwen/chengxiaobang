// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "../src/renderer/components/ui/button";

function classesOf(ui: React.ReactElement): string {
  const { container } = render(ui);
  return container.querySelector("button")?.className ?? "";
}

/**
 * The Button variant API is consumed across ~20 call sites; these assertions
 * pin each variant to its DESIGN.md role so a style rewrite that breaks the
 * mapping fails loudly instead of silently restyling every consumer.
 */
describe("Button variants (DESIGN.md roles)", () => {
  it("default = button-primary: near-black pill", () => {
    const className = classesOf(<Button>主操作</Button>);
    expect(className).toContain("rounded-pill");
    expect(className).toContain("bg-primary");
    expect(className).toContain("text-button");
  });

  it("outline = button-pill-outline: 30px outlined pill", () => {
    const className = classesOf(<Button variant="outline">筛选</Button>);
    expect(className).toContain("rounded-xl");
    expect(className).toContain("border-primary");
  });

  it("secondary = button-secondary: text-only underlined link", () => {
    const className = classesOf(<Button variant="secondary">次操作</Button>);
    expect(className).toContain("underline");
    expect(className).toContain("bg-transparent");
    expect(className).toContain("px-0");
  });

  it("link uses the editorial action-blue", () => {
    const className = classesOf(<Button variant="link">链接</Button>);
    expect(className).toContain("text-action-blue");
  });

  it("ghost stays a quiet hover affordance", () => {
    const className = classesOf(<Button variant="ghost">幽灵</Button>);
    expect(className).toContain("hover:bg-accent");
  });
});
