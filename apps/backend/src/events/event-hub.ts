import { createId } from "@chengxiaobang/shared";
import { AsyncEventQueue } from "../agent/async-queue";

/**
 * 进程内 live 事件总线：只负责把新事件广播给当前在线订阅者，不做回放或落库。
 */
export class EventHub<T> {
  private readonly subscribers = new Map<string, AsyncEventQueue<T>>();

  subscribe(signal?: AbortSignal): AsyncIterable<T> {
    const id = createId("event_sub");
    const queue = new AsyncEventQueue<T>();
    this.subscribers.set(id, queue);
    console.info("[event-hub] 新增事件流订阅", {
      subscriberId: id,
      subscriberCount: this.subscribers.size
    });

    const cleanup = (): void => {
      if (!this.subscribers.delete(id)) {
        return;
      }
      queue.end();
      signal?.removeEventListener("abort", cleanup);
      console.info("[event-hub] 事件流订阅已关闭", {
        subscriberId: id,
        subscriberCount: this.subscribers.size
      });
    };

    if (signal?.aborted) {
      cleanup();
      return queue;
    }
    signal?.addEventListener("abort", cleanup, { once: true });
    const iterator = queue[Symbol.asyncIterator]();
    return {
      [Symbol.asyncIterator]() {
        return {
          next: () => iterator.next(),
          return: async () => {
            cleanup();
            return { value: undefined as never, done: true };
          },
          throw: async (error?: unknown) => {
            cleanup();
            throw error;
          }
        };
      }
    };
  }

  publish(event: T): void {
    for (const queue of this.subscribers.values()) {
      queue.push(event);
    }
  }
}
