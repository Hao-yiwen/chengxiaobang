import { describe, expect, it } from "vitest";
import { encodeSseEvent, parseSseChunk, type AppEvent, type StreamEvent } from "../src/index";

describe("SSE helpers", () => {
  it("round trips stream events", () => {
    const events: StreamEvent[] = [
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
          name: "write_file",
          argsPreview: { path: "src/app.ts" },
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

    // Multiple blocks in one chunk parse in order.
    expect(parseSseChunk(events.map(encodeSseEvent).join(""))).toEqual(events);
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

    expect(parseSseChunk(events.map(encodeSseEvent).join(""))).toEqual(events);
  });
});
