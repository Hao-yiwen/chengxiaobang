import { describe, expect, it } from "vitest";
import { readSseStream } from "../src/renderer/lib/api";

describe("readSseStream", () => {
  it("handles partial chunks", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('event: delta\ndata: {"type":"delta","channel":"text"')
        );
        controller.enqueue(encoder.encode(',"runId":"run_1","delta":"你"}\n\n'));
        controller.close();
      }
    });
    const events: unknown[] = [];
    await readSseStream(stream, (event) => events.push(event));
    expect(events).toEqual([
      { type: "delta", channel: "text", runId: "run_1", delta: "你" }
    ]);
  });
});
