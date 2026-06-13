// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@chengxiaobang/shared";
import { ChatView } from "../src/renderer/components/ChatView";
import { TooltipProvider } from "../src/renderer/components/ui/tooltip";
import { setupI18n } from "../src/renderer/i18n";
import { resetAppStore, useAppStore } from "../src/renderer/store";

describe("ChatView 用户附件", () => {
  beforeEach(() => {
    setupI18n("zh");
    resetAppStore();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:attachment-preview")
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn()
    });
    window.chengxiaobang = {
      readFilePreviewBuffer: vi.fn(async () => ({
        ok: true,
        path: "/tmp/cxb/screenshot.png",
        name: "screenshot.png",
        data: new ArrayBuffer(8),
        size: 8,
        truncated: false
      }))
    } as never;
  });

  it("显示原始图片附件且不显示隐藏 OCR 文本", async () => {
    const message: Message = {
      id: "msg_1",
      sessionId: "session_1",
      role: "user",
      content: "这个图片展示了什么？",
      attachments: [
        {
          id: "attachment_1",
          name: "screenshot.png",
          kind: "image",
          mimeType: "image/png",
          size: 128,
          path: "/tmp/cxb/screenshot.png"
        }
      ],
      createdAt: "2026-06-13T00:00:00.000Z"
    };
    useAppStore.setState({
      activeSessionId: "session_1",
      view: "chat",
      messages: [message],
      toolHistory: []
    });

    render(
      <TooltipProvider>
        <ChatView />
      </TooltipProvider>
    );

    expect(screen.getByText("这个图片展示了什么？")).toBeInTheDocument();
    expect(screen.queryByText("OCR 识别文字")).not.toBeInTheDocument();
    const image = await screen.findByAltText("附件图片 screenshot.png");
    expect(image).toHaveAttribute("src", "blob:attachment-preview");

    fireEvent.click(image.closest("button")!);

    await waitFor(() => {
      expect(useAppStore.getState().previewFile?.path).toBe("/tmp/cxb/screenshot.png");
      expect(useAppStore.getState().rightPanelMode).toBe("files");
    });
  });
});
