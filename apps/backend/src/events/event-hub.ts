import { createId } from "@chengxiaobang/shared";
import { AsyncEventQueue } from "../agent/async-queue";

export interface EventEnvelope<T> {
  id: string;
  event: T;
}

export interface EventHubSubscribeOptions {
  signal?: AbortSignal;
  afterId?: string;
}

const DEFAULT_REPLAY_LIMIT = 1_000;

/**
 * 进程内 live 事件总线：广播新事件，并保留短期有序回放缓冲。
 */
export class EventHub<T> {
  private readonly subscribers = new Map<string, AsyncEventQueue<EventEnvelope<T>>>();
  private readonly replayBuffer: EventEnvelope<T>[] = [];
  private nextEventId = 1;

  constructor(private readonly replayLimit = DEFAULT_REPLAY_LIMIT) {}

  async *subscribe(signal?: AbortSignal): AsyncIterable<T> {
    for await (const envelope of this.subscribeEnvelopes({ signal })) {
      yield envelope.event;
    }
  }

  subscribeEnvelopes(options: EventHubSubscribeOptions = {}): AsyncIterable<EventEnvelope<T>> {
    const id = createId("event_sub");
    const queue = new AsyncEventQueue<EventEnvelope<T>>();
    const replay = this.replayAfter(options.afterId);
    for (const envelope of replay) {
      queue.push(envelope);
    }
    this.subscribers.set(id, queue);
    console.info("[event-hub] 新增事件流订阅", {
      subscriberId: id,
      subscriberCount: this.subscribers.size,
      afterId: options.afterId,
      replayCount: replay.length
    });

    const cleanup = (): void => {
      if (!this.subscribers.delete(id)) {
        return;
      }
      queue.end();
      options.signal?.removeEventListener("abort", cleanup);
      console.info("[event-hub] 事件流订阅已关闭", {
        subscriberId: id,
        subscriberCount: this.subscribers.size
      });
    };

    if (options.signal?.aborted) {
      cleanup();
      return queue;
    }
    options.signal?.addEventListener("abort", cleanup, { once: true });
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

  publish(event: T): EventEnvelope<T> {
    const envelope = { id: String(this.nextEventId++), event };
    this.replayBuffer.push(envelope);
    while (this.replayBuffer.length > this.replayLimit) {
      this.replayBuffer.shift();
    }
    for (const queue of this.subscribers.values()) {
      queue.push(envelope);
    }
    return envelope;
  }

  private replayAfter(afterId: string | undefined): EventEnvelope<T>[] {
    if (!afterId) {
      return [];
    }
    const lastSeen = Number.parseInt(afterId, 10);
    if (!Number.isFinite(lastSeen)) {
      console.warn("[event-hub] 忽略非法事件回放位置", { afterId });
      return [];
    }
    return this.replayBuffer.filter((envelope) => Number.parseInt(envelope.id, 10) > lastSeen);
  }
}
