// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ModelDebugRecord } from "@chengxiaobang/shared";
import { ModelDebugDot } from "../src/renderer/components/ModelDebugDot";

function record(overrides: Partial<ModelDebugRecord> = {}): ModelDebugRecord {
  return {
    id: "debug_1",
    runId: "run_1",
    sessionId: "s1",
    userMessageId: "m1",
    source: "agent",
    attemptIndex: 0,
    requestIndex: 0,
    providerId: "deepseek",
    providerKind: "deepseek",
    model: "deepseek-v4-flash",
    api: "openai-completions",
    status: "completed",
    request: {
      model: "deepseek-v4-flash",
      messages: [
        {
          role: "user",
          content: "# 标题\n\n<system-reminder>项目指令</system-reminder>\n\n- 项目"
        }
      ],
      tools: [
        {
          name: "Edit",
          description: "## 工具说明\n\n- 精确字符串替换",
          parameters: {
            properties: {
              file_path: {
                type: "string",
                description: "相对工作目录的文件路径"
              }
            }
          }
        }
      ]
    },
    response: {
      status: 200,
      assistantMessage: { role: "assistant", content: [{ type: "text", text: "ok" }] },
      usage: { promptTokens: 3, completionTokens: 5, totalTokens: 8 },
      stopReason: "stop"
    },
    requestBytes: 128,
    responseBytes: 256,
    createdAt: "2026-06-11T00:00:01.000Z",
    updatedAt: "2026-06-11T00:00:02.000Z",
    ...overrides
  };
}

describe("ModelDebugDot", () => {
  it("opens a standalone dialog and switches between request and response JSON", () => {
    render(<ModelDebugDot records={[record()]} messageId="m1" />);

    const trigger = screen.getByRole("button", { name: "查看模型请求调试，共 1 条" });
    expect(screen.queryByLabelText("模型请求体")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "模型请求调试" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "标题" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "工具说明" })).toBeInTheDocument();
    expect(screen.getByLabelText("模型请求体")).toHaveTextContent("<system-reminder>");
    expect(screen.getByLabelText("模型请求体")).toHaveTextContent("</system-reminder>");
    expect(screen.getByLabelText("模型请求体")).toHaveTextContent("deepseek-v4-flash");
    expect(screen.getByLabelText("模型请求体")).toHaveTextContent('"content":');

    fireEvent.click(screen.getByRole("button", { name: "返回结果" }));
    expect(screen.getByLabelText("模型返回结果")).toHaveTextContent("stop");
    expect(screen.getByLabelText("模型返回结果")).toHaveTextContent("promptTokens");
    expect(screen.getByText("ok")).toBeInTheDocument();
  });

  it("can switch between multiple model requests in the dialog", () => {
    render(
      <ModelDebugDot
        messageId="m1"
        records={[
          record(),
          record({
            id: "debug_2",
            attemptIndex: 1,
            requestIndex: 0,
            model: "kimi-k2",
            request: { model: "kimi-k2", messages: [{ role: "user", content: "again" }] }
          })
        ]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "查看模型请求调试，共 2 条" }));
    fireEvent.click(screen.getByRole("button", { name: /模型请求 2\.1/ }));

    expect(screen.getByLabelText("模型请求体")).toHaveTextContent("kimi-k2");
  });
});
