// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeSseEvent, type AppEvent, type StreamEvent } from "@chengxiaobang/shared";
import { createApiClient, readSseStream } from "../src/renderer/lib/api";

afterEach(() => {
  vi.useRealTimers();
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

  it("tracks SSE event ids", async () => {
    const event: StreamEvent = {
      type: "run_started",
      runId: "run_1",
      sessionId: "session_1"
    };
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(encodeSseEvent(event, "7")));
        controller.close();
      }
    });
    const events: StreamEvent[] = [];
    const ids: string[] = [];
    await readSseStream<StreamEvent>(stream, (item) => events.push(item), {
      onEventId: (id) => ids.push(id)
    });

    expect(events).toEqual([event]);
    expect(ids).toEqual(["7"]);
  });

  it("reconnects the global event stream with the last event id", async () => {
    vi.useFakeTimers();
    const runStarted: StreamEvent = {
      type: "run_started",
      runId: "run_1",
      sessionId: "session_1"
    };
    const runEnd: StreamEvent = {
      type: "run_end",
      runId: "run_1",
      status: "completed"
    };
    const encoder = new TextEncoder();
    const fetchMock = vi.fn(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const event =
            fetchMock.mock.calls.length === 1
              ? encodeSseEvent(runStarted, "7")
              : encodeSseEvent(runEnd, "8");
          controller.enqueue(encoder.encode(event));
          controller.close();
        }
      });
      return new Response(stream, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await createApiClient();
    const events: StreamEvent[] = [];
    const unsubscribe = client.subscribeRunEvents?.((event) => events.push(event));

    await vi.waitFor(() => expect(events).toEqual([runStarted]));
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => expect(events).toEqual([runStarted, runEnd]));
    const fetchCalls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit?]>;
    expect(String(fetchCalls[1]?.[0])).toContain("lastEventId=7");

    unsubscribe?.();
    vi.useRealTimers();
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
          controller.enqueue(
            encoder.encode([taskEvent, runEvent].map((event) => encodeSseEvent(event)).join(""))
          );
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
