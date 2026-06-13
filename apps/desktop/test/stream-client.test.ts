// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeSseEvent, type AppEvent, type StreamEvent } from "@chengxiaobang/shared";
import { createApiClient, readSseStream } from "../src/renderer/lib/api";

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it("keeps run subscriptions filtered while app subscriptions receive task events", async () => {
    const taskEvent: AppEvent = {
      type: "scheduled_task_finished",
      taskId: "task_1",
      sessionId: "session_1",
      name: "AI 日报",
      trigger: "schedule",
      status: "completed",
      occurredAt: "2026-06-13T01:00:00.000Z"
    };
    const runEvent: StreamEvent = {
      type: "run_started",
      runId: "run_1",
      sessionId: "session_1"
    };
    const encoder = new TextEncoder();
    const fetchMock = vi.fn(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode([taskEvent, runEvent].map(encodeSseEvent).join("")));
          controller.close();
        }
      });
      return new Response(stream, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await createApiClient();
    const appEvents: AppEvent[] = [];
    const runEvents: StreamEvent[] = [];
    const unsubscribeApp = client.subscribeAppEvents?.((event) => appEvents.push(event));
    const unsubscribeRun = client.subscribeRunEvents?.((event) => runEvents.push(event));

    await vi.waitFor(() => expect(appEvents).toHaveLength(2));
    expect(runEvents).toEqual([runEvent]);

    unsubscribeRun?.();
    unsubscribeApp?.();
  });
});
