// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { ReasoningPanel } from "../src/renderer/components/ReasoningPanel";
import { setupI18n } from "../src/renderer/i18n";

beforeAll(() => {
  setupI18n("zh");
});

function foldGrid(container: HTMLElement): HTMLElement {
  const element = Array.from(container.querySelectorAll<HTMLElement>("div")).find((item) =>
    item.className.includes("transition-[grid-template-rows]")
  );
  if (!element) {
    throw new Error("未找到思考内容折叠容器");
  }
  return element;
}

function foldBody(grid: HTMLElement): HTMLElement {
  const element = grid.firstElementChild;
  if (!(element instanceof HTMLElement)) {
    throw new Error("未找到思考内容折叠主体");
  }
  return element;
}

describe("ReasoningPanel", () => {
  it("流式思考默认收起，点击后才展开内容", () => {
    const { container } = render(
      <ReasoningPanel text="这里是流式思考内容" streaming startedAt={Date.now() - 1000} />
    );

    const button = screen.getByRole("button", { name: /思考中/ });
    const grid = foldGrid(container);

    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(grid).toHaveClass("grid-rows-[0fr]");
    expect(foldBody(grid)).toHaveClass("min-h-0", "overflow-hidden");

    fireEvent.click(button);

    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(grid).toHaveClass("grid-rows-[1fr]");
  });
});
