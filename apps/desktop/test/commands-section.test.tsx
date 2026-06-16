// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { SlashCommand } from "@chengxiaobang/shared";
import { CommandsSection } from "../src/renderer/components/settings/CommandsSection";
import { TooltipProvider } from "../src/renderer/components/ui/tooltip";
import { setupI18n } from "../src/renderer/i18n";
import { resetAppStore, useAppStore } from "../src/renderer/store";

beforeEach(() => {
  setupI18n("zh");
  resetAppStore();
});

describe("CommandsSection", () => {
  it("keeps command rows on one line and exposes the full description in a tooltip", async () => {
    const longDescription =
      "Use when implementation is complete, all tests pass, and you need to decide how to integrate the work by presenting structured options for merge, PR, or cleanup";
    const command: SlashCommand = {
      id: "plugin:superpowers:/finishing-a-development-branch",
      name: "/finishing-a-development-branch",
      kind: "skill",
      description: longDescription,
      source: "plugin",
      insertText: "/finishing-a-development-branch ",
      pluginName: "superpowers",
      argumentHint: "[目标]",
      enabled: true
    };
    useAppStore.setState({ slashCommands: [command] });

    render(
      <TooltipProvider delayDuration={0}>
        <CommandsSection />
      </TooltipProvider>
    );

    const list = await screen.findByTestId("settings-commands-list");
    const commandName = within(list).getByText("/finishing-a-development-branch");
    const row = commandName.closest("div");
    expect(row).toHaveClass("grid");

    const description = within(list).getByText(longDescription);
    expect(description).toHaveClass("truncate");
    expect(within(list).getByText("[目标]")).toHaveClass("truncate");
    expect(within(list).getByText("来自 superpowers")).toBeInTheDocument();

    fireEvent.pointerMove(description, { pointerType: "mouse" });
    fireEvent.mouseEnter(description);

    expect(await screen.findByRole("tooltip")).toHaveTextContent(longDescription);
    expect(screen.getByRole("tooltip")).toHaveTextContent("[目标]");
  });
});
