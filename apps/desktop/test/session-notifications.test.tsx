// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationToasts } from "../src/renderer/components/NotificationToasts";
import { resetAppStore, useAppStore, type NotificationToast } from "../src/renderer/store";

const sessionToast: NotificationToast = {
  id: "toast_session_done",
  kind: "success",
  title: "会话「后台任务」已完成",
  description: "点击查看结果。",
  sessionId: "session_other",
  runId: "run_other",
  createdAt: Date.now()
};

function installSessionToast(selectSession = vi.fn(async () => {})) {
  useAppStore.setState({
    notificationToasts: [sessionToast],
    selectSession: selectSession as never
  });
  return selectSession;
}

beforeEach(() => {
  window.localStorage.clear();
  resetAppStore();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn(async () => undefined)
    }
  });
});

describe("session notification toasts", () => {
  it("clicks the toast body to switch to the target session", async () => {
    const selectSession = installSessionToast();

    render(<NotificationToasts />);
    fireEvent.click(await screen.findByText("会话「后台任务」已完成"));

    await waitFor(() => expect(selectSession).toHaveBeenCalledWith("session_other"));
    expect(useAppStore.getState().notificationToasts).toHaveLength(0);
  });

  it("does not switch sessions when copying or closing the toast", async () => {
    const selectSession = installSessionToast();

    render(<NotificationToasts />);
    fireEvent.click(await screen.findByRole("button", { name: "复制提示" }));

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "会话「后台任务」已完成\n点击查看结果。"
      )
    );
    expect(selectSession).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTitle("关闭提示"));
    expect(selectSession).not.toHaveBeenCalled();
  });
});
