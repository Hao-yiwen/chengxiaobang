import { describe, expect, it } from "vitest";
import { encodeSseEvent, parseSseChunk, type StreamEvent } from "../src/index";

describe("SSE helpers", () => {
  it("round trips stream events", () => {
    const events: StreamEvent[] = [
      { type: "run_started", runId: "run_1", sessionId: "session_1" },
      { type: "delta", runId: "run_1", channel: "text", delta: "你好" },
      { type: "delta", runId: "run_1", channel: "thinking", delta: "先想想" },
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
});
