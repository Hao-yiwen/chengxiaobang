// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  STAMP_TONE_COLORS,
  StampBadge,
  type StampTone
} from "../src/renderer/components/StampBadge";

describe("StampBadge（UI-SPEC §2.1 印章标）", () => {
  it("渲染显示字，并以 fullLabel 提供 title 与 aria-label", () => {
    render(<StampBadge text="成" fullLabel="成功" tone="moss" />);
    const badge = screen.getByText("成");
    expect(badge).toHaveAttribute("title", "成功");
    expect(badge).toHaveAttribute("aria-label", "成功");
    expect(screen.getByLabelText("成功")).toBe(badge);
  });

  it("允许双字显示字，不强行单字", () => {
    render(<StampBadge text="已转" fullLabel="已转为任务" tone="moss" />);
    expect(screen.getByText("已转")).toHaveAttribute("aria-label", "已转为任务");
  });

  it("在根元素上标注 tone，供样式与测试钩取", () => {
    render(<StampBadge text="候" fullLabel="待批准" tone="ochre" />);
    expect(screen.getByText("候")).toHaveAttribute("data-tone", "ochre");
  });

  it("六个 tone 映射到对应 Vercel 语义变量，边框同色 60% 透明度", () => {
    const expected: Record<StampTone, string> = {
      moss: "--moss",
      danger: "--destructive",
      ochre: "--ochre",
      indigo: "--indigo",
      ink: "--ink-3",
      faint: "--ink-4"
    };
    for (const [tone, variable] of Object.entries(expected) as [StampTone, string][]) {
      expect(STAMP_TONE_COLORS[tone].color).toBe(`rgb(var(${variable}))`);
      expect(STAMP_TONE_COLORS[tone].border).toBe(`rgb(var(${variable}) / 0.6)`);
    }
  });
});
