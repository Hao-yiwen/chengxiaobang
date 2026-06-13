import { describe, expect, it } from "vitest";
import { EventHub } from "../src/events/event-hub";

async function collect<T>(events: AsyncIterable<T>, seen: T[]): Promise<void> {
  for await (const event of events) {
    seen.push(event);
  }
}

describe("EventHub", () => {
  it("向多个订阅者广播 live 事件", async () => {
    const hub = new EventHub<string>();
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first: string[] = [];
    const second: string[] = [];
    const firstTask = collect(hub.subscribe(firstController.signal), first);
    const secondTask = collect(hub.subscribe(secondController.signal), second);

    hub.publish("a");
    hub.publish("b");
    firstController.abort();
    secondController.abort();
    await Promise.all([firstTask, secondTask]);

    expect(first).toEqual(["a", "b"]);
    expect(second).toEqual(["a", "b"]);
  });

  it("退订后不再收到后续事件", async () => {
    const hub = new EventHub<number>();
    const controller = new AbortController();
    const seen: number[] = [];
    const task = collect(hub.subscribe(controller.signal), seen);

    hub.publish(1);
    controller.abort();
    await task;
    hub.publish(2);

    expect(seen).toEqual([1]);
  });
});
