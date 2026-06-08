import { describe, expect, it } from "vitest";
import { encodeSseEvent, parseSseChunk } from "../src/index";

describe("SSE helpers", () => {
  it("round trips stream events", () => {
    const event = {
      type: "assistant_delta" as const,
      runId: "run_1",
      delta: "你好"
    };

    expect(parseSseChunk(encodeSseEvent(event))).toEqual([event]);
  });
});
