// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  RunMetaLine,
  formatRunDuration,
  formatTokenCount
} from "../src/renderer/components/RunMetaLine";
import { setupI18n } from "../src/renderer/i18n";
import { TooltipProvider } from "../src/renderer/components/ui/tooltip";

beforeAll(() => {
  setupI18n("zh");
});

function renderLine(overrides: Partial<React.ComponentProps<typeof RunMetaLine>> = {}) {
  const onCopy = vi.fn();
  const onRegenerate = vi.fn();
  const onFork = vi.fn();
  const utils = render(
    <TooltipProvider>
      <RunMetaLine
        durationMs={12_400}
        totalTokens={2113}
        model="deepseek-v4-flash"
        onCopy={onCopy}
        onRegenerate={onRegenerate}
        onFork={onFork}
        {...overrides}
      />
    </TooltipProvider>
  );
  return { ...utils, onCopy, onRegenerate, onFork };
}

describe("formatRunDuration（UI-SPEC §3.2）", () => {
  it("不足 60s 取一位小数", () => {
    expect(formatRunDuration(12_400)).toBe("12.4s");
    expect(formatRunDuration(432)).toBe("0.4s");
    expect(formatRunDuration(0)).toBe("0.0s");
  });

  it("≥60s 用 m s 形式", () => {
    expect(formatRunDuration(60_000)).toBe("1m 0s");
    expect(formatRunDuration(72_000)).toBe("1m 12s");
    expect(formatRunDuration(125_400)).toBe("2m 5s");
  });

  it("负值按 0 处理（容错坏数据）", () => {
    expect(formatRunDuration(-5)).toBe("0.0s");
  });
});

describe("formatTokenCount（UI-SPEC §3.2）", () => {
  it("千分位 + tok 后缀", () => {
    expect(formatTokenCount(2113)).toBe("2,113 tok");
    expect(formatTokenCount(987)).toBe("987 tok");
    expect(formatTokenCount(1_234_567)).toBe("1,234,567 tok");
  });
});

describe("RunMetaLine 仪表行", () => {
  it("常驻渲染 `时长 · tok · 模型名` 一行", () => {
    renderLine();
    expect(screen.getByText("12.4s · 2,113 tok · deepseek-v4-flash")).toBeInTheDocument();
  });

  it("传入推理模式时追加档位", () => {
    renderLine({ model: "deepseek-v4-pro", reasoningMode: "xhigh" });
    expect(screen.getByText("12.4s · 2,113 tok · deepseek-v4-pro · XHigh")).toBeInTheDocument();
  });

  it("hover 组内有 复制/重新生成/fork 三个动作钮，点击触发回调", () => {
    const { onCopy, onRegenerate, onFork } = renderLine();
    fireEvent.click(screen.getByRole("button", { name: "复制" }));
    expect(onCopy).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "重新生成" }));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "从这条消息创建分支" }));
    expect(onFork).toHaveBeenCalledTimes(1);
  });

  it("hover 现身延迟 80ms 只挂在 hover 态（离开即隐）", () => {
    const { container } = renderLine();
    const group = container.querySelector(".group-hover\\/meta\\:opacity-100");
    expect(group).not.toBeNull();
    expect(group?.className).toContain("opacity-0");
    expect(group?.className).toContain("group-hover/meta:delay-[80ms]");
  });

  it("复制后浮现「已录」印章回执，1.5s 后淡回（UI-SPEC §13.2）", () => {
    vi.useFakeTimers();
    try {
      renderLine();
      fireEvent.click(screen.getByRole("button", { name: "复制" }));
      const stamp = screen.getByText("已录");
      expect(stamp).toHaveAttribute("aria-label", "已复制");
      expect(stamp).toHaveAttribute("data-tone", "moss");
      act(() => {
        vi.advanceTimersByTime(1600);
      });
      expect(screen.queryByText("已录")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
