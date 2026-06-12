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
 * Button variant API 被多个调用点复用；这些断言把 variant 固定到 DESIGN.md 角色，
 * 避免主题调整时悄悄改坏全局按钮语义。
 */
describe("Button variants (DESIGN.md roles)", () => {
  it("default = button-primary: black Vercel pill", () => {
    const className = classesOf(<Button>主操作</Button>);
    expect(className).toContain("rounded-pill");
    expect(className).toContain("bg-primary");
    expect(className).toContain("text-button");
  });

  it("outline = button-secondary: white pill with hairline", () => {
    const className = classesOf(<Button variant="outline">筛选</Button>);
    expect(className).toContain("rounded-pill");
    expect(className).toContain("border-hairline");
    expect(className).toContain("bg-canvas");
  });

  it("secondary = paired white pill", () => {
    const className = classesOf(<Button variant="secondary">次操作</Button>);
    expect(className).toContain("border-hairline");
    expect(className).toContain("bg-canvas");
    expect(className).toContain("text-ink");
  });

  it("link uses Vercel link blue", () => {
    const className = classesOf(<Button variant="link">链接</Button>);
    expect(className).toContain("text-link");
  });

  it("ghost stays a quiet hover affordance", () => {
    const className = classesOf(<Button variant="ghost">幽灵</Button>);
    expect(className).toContain("hover:bg-accent");
  });
});
