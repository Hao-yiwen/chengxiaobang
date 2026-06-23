// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileChange, Message, RunRecord, Session } from "@chengxiaobang/shared";
import { ChatView } from "../src/renderer/components/ChatView";
import { RunFileChangesCard } from "../src/renderer/components/RunFileChangesCard";
import { TooltipProvider } from "../src/renderer/components/ui/tooltip";
import { setupI18n } from "../src/renderer/i18n";
import { resetAppStore, useAppStore } from "../src/renderer/store";

vi.mock("@pierre/diffs/react", () => ({
  FileDiff: ({ fileDiff }: { fileDiff: { additionLines: string[]; deletionLines: string[] } }) =>
    [...fileDiff.deletionLines, ...fileDiff.additionLines].join("\n"),
  MultiFileDiff: ({
    oldFile,
    newFile
  }: {
    oldFile: { contents: string };
    newFile: { contents: string };
  }) => `-${oldFile.contents}\n+${newFile.contents}`
}));

const firstChange: FileChange = {
  path: "src/app.ts",
  operation: "write",
  patch: patchFor("src/app.ts", [], ["hello", "world"]),
  additions: 2,
  deletions: 0,
  toolCallIds: ["tool_1"]
};

const secondChange: FileChange = {
  path: "src/util.ts",
  operation: "edit",
  patch: patchFor("src/util.ts", ["old"], ["new"]),
  additions: 1,
  deletions: 1,
  toolCallIds: ["tool_2"]
};

beforeAll(() => {
  setupI18n("zh");
});

beforeEach(() => {
  resetAppStore();
});

describe("RunFileChangesCard", () => {
  it("lists changed files and expands only the clicked file diff", async () => {
    render(
      <RunFileChangesCard
        runId="run_1"
        fileChanges={[firstChange, secondChange]}
      />
    );

    expect(screen.getByText("2 个文件已更改")).toBeInTheDocument();
    expect(screen.getByText("+3")).toBeInTheDocument();
    expect(screen.getAllByText("-1").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("src/app.ts")).not.toBeInTheDocument();
    expect(screen.queryByText("src/util.ts")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("变更对比")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("2 个文件已更改"));
    expect(screen.getByTestId("run-file-changes-list-collapse").className).toContain(
      "transition-[grid-template-rows,opacity]"
    );
    expect(screen.getByText("app.ts")).toBeInTheDocument();
    expect(screen.getByText("util.ts")).toBeInTheDocument();
    expect(screen.queryByText("src/app.ts")).not.toBeInTheDocument();
    expect(screen.queryByText("src/util.ts")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("app.ts"));
    const diffBody = screen.getByTestId("run-file-change-diff-body");
    expect(diffBody).toBeInTheDocument();
    expect(diffBody.className).not.toContain("transition-[grid-template-rows,opacity]");
    expect(screen.getByLabelText("变更对比")).toHaveTextContent("hello");
    expect(screen.getByLabelText("变更对比")).toHaveClass("scrollbar-hidden");
    expect(screen.getByLabelText("变更对比")).toHaveStyle("--diffs-gap-block: 0px");
    expect(screen.queryByText("old")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("util.ts"));
    await waitFor(() => {
      expect(screen.getAllByLabelText("变更对比")).toHaveLength(1);
    });
    const [diffView] = screen.getAllByLabelText("变更对比");
    expect(diffView).toHaveTextContent("old");
    expect(diffView).toHaveTextContent("new");
    expect(diffView).not.toHaveTextContent("hello");
  });

  it("opens the clicked file diff on the first click when scrollHeight is zero", () => {
    render(
      <RunFileChangesCard
        runId="run_1"
        fileChanges={[firstChange]}
      />
    );

    fireEvent.click(screen.getByText("1 个文件已更改"));
    fireEvent.click(screen.getByText("app.ts"));

    const diffBody = screen.getByTestId("run-file-change-diff-body");
    expect(diffBody).toBeInTheDocument();
    expect(diffBody.className).not.toContain("grid-rows-[0fr]");
    expect(diffBody).not.toHaveStyle({ height: "0px" });
    expect(screen.getByLabelText("变更对比")).toHaveTextContent("hello");
  });

  it("opens the file diff on the first click in React strict mode and logs once per toggle", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    try {
      render(
        <React.StrictMode>
          <RunFileChangesCard
            runId="run_1"
            fileChanges={[firstChange]}
          />
        </React.StrictMode>
      );

      const cardButton = screen.getByText("1 个文件已更改").closest("button");
      expect(cardButton).toBeTruthy();
      fireEvent.click(cardButton!);
      expect(cardButton).toHaveAttribute("aria-expanded", "true");

      const fileButton = screen.getByText("app.ts").closest("button");
      expect(fileButton).toBeTruthy();
      fireEvent.click(fileButton!);
      expect(fileButton).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByTestId("run-file-change-diff-body")).toBeInTheDocument();
      expect(screen.getByLabelText("变更对比")).toHaveTextContent("hello");
      expect(infoSpy).toHaveBeenCalledTimes(2);
      expect(infoSpy).toHaveBeenNthCalledWith(
        1,
        "[RunFileChangesCard] 切换本轮 diff 卡片",
        expect.objectContaining({ runId: "run_1", open: true, fileCount: 1 })
      );
      expect(infoSpy).toHaveBeenNthCalledWith(
        2,
        "[RunFileChangesCard] 切换单文件 diff",
        expect.objectContaining({
          runId: "run_1",
          path: "src/app.ts",
          open: true,
          additions: 2,
          deletions: 0
        })
      );
    } finally {
      infoSpy.mockRestore();
    }
  });

  it("renders below the final answer content and above assistant message actions", () => {
    const session: Session = {
      id: "session_1",
      projectId: null,
      title: "对话",
      accessMode: "approval",
      createdAt: "2026-06-11T00:00:00.000Z",
      updatedAt: "2026-06-11T00:00:04.000Z"
    };
    const messages: Message[] = [
      {
        id: "user_1",
        sessionId: session.id,
        role: "user",
        content: "改文件",
        createdAt: "2026-06-11T00:00:00.000Z"
      },
      {
        id: "assistant_1",
        sessionId: session.id,
        role: "assistant",
        content: "已经改好",
        createdAt: "2026-06-11T00:00:03.000Z"
      }
    ];
    const run: RunRecord = {
      id: "run_1",
      sessionId: session.id,
      status: "completed",
      createdAt: "2026-06-11T00:00:00.000Z",
      updatedAt: "2026-06-11T00:00:04.000Z",
      fileChanges: [firstChange]
    };
    useAppStore.setState({
      sessions: [session],
      activeSessionId: session.id,
      messages,
      runHistory: [run],
      onboardingOpen: false,
      onboardingCompleted: true
    });

    render(
      <TooltipProvider>
        <ChatView />
      </TooltipProvider>
    );

    const answer = screen.getByText("已经改好");
    const card = screen.getByTestId("run-file-changes-card");
    const assistantCopy = screen.getAllByRole("button", { name: "复制" }).at(-1);
    expect(assistantCopy).toBeDefined();
    expect(answer.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      card.compareDocumentPosition(assistantCopy!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});

function patchFor(path: string, removed: string[], added: string[]): string {
  const oldRange = removed.length > 0 ? `1,${removed.length}` : "0,0";
  const newRange = added.length > 0 ? `1,${added.length}` : "0,0";
  return [
    `diff --git a/${path} b/${path}`,
    removed.length > 0 ? `--- a/${path}` : "--- /dev/null",
    `+++ b/${path}`,
    `@@ -${oldRange} +${newRange} @@`,
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`)
  ].join("\n");
}
