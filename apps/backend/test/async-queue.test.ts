import { describe, expect, it } from "vitest";
import { AsyncEventQueue } from "../src/agent/async-queue";

async function drain<T>(queue: AsyncEventQueue<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of queue) {
    items.push(item);
  }
  return items;
}

describe("AsyncEventQueue", () => {
  it("delivers buffered items then ends", async () => {
    const queue = new AsyncEventQueue<number>();
    queue.push(1);
    queue.push(2);
    queue.end();
    await expect(drain(queue)).resolves.toEqual([1, 2]);
  });

  it("wakes a waiting consumer when an item arrives", async () => {
    const queue = new AsyncEventQueue<string>();
    const pending = drain(queue);
    queue.push("a");
    queue.end();
    await expect(pending).resolves.toEqual(["a"]);
  });

  it("drains the buffer before surfacing a failure", async () => {
    const queue = new AsyncEventQueue<number>();
    queue.push(1);
    queue.fail(new Error("boom"));

    const seen: number[] = [];
    await expect(
      (async () => {
        for await (const item of queue) {
          seen.push(item);
        }
      })()
    ).rejects.toThrow("boom");
    expect(seen).toEqual([1]);
  });

  it("ignores pushes after end", async () => {
    const queue = new AsyncEventQueue<number>();
    queue.push(1);
    queue.end();
    queue.push(2);
    await expect(drain(queue)).resolves.toEqual([1]);
  });
});
