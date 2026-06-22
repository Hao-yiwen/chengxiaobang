import { describe, expect, it } from "vitest";
import { encodeSseEvent, parseSseChunk, type AppEvent, type StreamEvent } from "../src/index";

describe("SSE helpers", () => {
  it("round trips stream events", () => {
    const events: StreamEvent[] = [
      { type: "setup_error", error: "请先配置模型" },
      {
        type: "run_started",
        runId: "run_1",
        sessionId: "session_1",
        clientRequestId: "client_1"
      },
      { type: "delta", runId: "run_1", channel: "text", delta: "你好" },
      { type: "delta", runId: "run_1", channel: "thinking", delta: "先想想" },
      {
        type: "tool_activity",
        runId: "run_1",
        activity: {
          contentIndex: 0,
          name: "Write",
          argsPreview: { file_path: "src/app.ts" },
          updatedAt: "2026-06-11T00:00:00.000Z"
        }
      },
      {
        type: "run_end",
        runId: "run_1",
        status: "completed",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
      }
    ];

    for (const event of events) {
      expect(parseSseChunk(encodeSseEvent(event))).toEqual([event]);
    }

    expect(encodeSseEvent(events[1], "42")).toContain("id: 42\n");
    expect(parseSseChunk(encodeSseEvent(events[1], "42"))).toEqual([events[1]]);

    // Multiple blocks in one chunk parse in order.
    expect(parseSseChunk(events.map((event) => encodeSseEvent(event)).join(""))).toEqual(events);
  });

  it("round trips app-level scheduled task events", () => {
    const events: AppEvent[] = [
      {
        type: "scheduled_task_started",
        taskId: "task_1",
        sessionId: "session_1",
        name: "AI 日报",
        trigger: "schedule",
        occurredAt: "2026-06-13T01:00:00.000Z"
      },
      {
        type: "scheduled_task_finished",
        taskId: "task_1",
        sessionId: "session_1",
        name: "AI 日报",
        trigger: "schedule",
        status: "completed",
        runId: "run_1",
        occurredAt: "2026-06-13T01:01:00.000Z"
      }
    ];

    expect(parseSseChunk(events.map((event) => encodeSseEvent(event)).join(""))).toEqual(events);
  });

  it("skips SSE comment/heartbeat blocks instead of throwing", () => {
    const event: StreamEvent = { type: "delta", runId: "run_1", channel: "text", delta: "你好" };
    // 心跳注释块(无 data 行)夹在事件之间:应被跳过而不是抛错。
    const chunk = `: keep-alive\n\n${encodeSseEvent(event)}: keep-alive\n\n`;
    expect(parseSseChunk(chunk)).toEqual([event]);
    // 纯心跳块解析为空数组。
    expect(parseSseChunk(": keep-alive\n\n")).toEqual([]);
  });
});
