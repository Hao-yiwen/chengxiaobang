// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { WorkTimer } from "../src/renderer/components/WorkTimer";
import { setupI18n } from "../src/renderer/i18n";

beforeAll(() => {
  setupI18n("zh");
});

function foldGrid(container: HTMLElement): HTMLElement {
  const element = Array.from(container.querySelectorAll<HTMLElement>("div")).find((item) =>
    item.className.includes("transition-[grid-template-rows]")
  );
  if (!element) {
    throw new Error("未找到 WorkTimer 折叠容器");
  }
  return element;
}

describe("WorkTimer", () => {
  it("运行中默认展开，结束后在同一个容器上平滑收起", () => {
    const { container, rerender } = render(
      <WorkTimer timing={{ mode: "running", startedAt: Date.now() - 1000 }} collapsible>
        <div>中间过程</div>
      </WorkTimer>
    );

    const runningGrid = foldGrid(container);
    expect(screen.getByText("中间过程")).toBeInTheDocument();
    expect(runningGrid).toHaveClass("transition-[grid-template-rows]", "duration-300", "ease-out");
    expect(runningGrid).toHaveClass("grid-rows-[1fr]");

    rerender(
      <WorkTimer timing={{ mode: "settled", durationMs: 2000 }} collapsible>
        <div>中间过程</div>
      </WorkTimer>
    );

    const settledGrid = foldGrid(container);
    expect(settledGrid).toBe(runningGrid);
    expect(settledGrid).toHaveClass("grid-rows-[0fr]");
  });
});
