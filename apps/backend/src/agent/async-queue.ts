/**
 * An unbounded async queue bridging push-style producers (the pi event sink,
 * the approval hook) to the pull-style AsyncGenerator the SSE stream consumes.
 */
export class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly buffered: T[] = [];
  private waiting?: { resolve: (result: IteratorResult<T>) => void; reject: (error: unknown) => void };
  private done = false;
  private error: unknown;

  push(value: T): void {
    if (this.done) {
      return;
    }
    if (this.waiting) {
      const { resolve } = this.waiting;
      this.waiting = undefined;
      resolve({ value, done: false });
      return;
    }
    this.buffered.push(value);
  }

  /** Marks the end of the stream; buffered items are still drained first. */
  end(): void {
    this.done = true;
    if (this.waiting && this.buffered.length === 0) {
      const { resolve } = this.waiting;
      this.waiting = undefined;
      resolve({ value: undefined, done: true });
    }
  }

  /** Ends the stream with an error, surfaced to the consumer after the buffer drains. */
  fail(error: unknown): void {
    if (this.done) {
      return;
    }
    this.error = error;
    this.done = true;
    if (this.waiting && this.buffered.length === 0) {
      const { reject } = this.waiting;
      this.waiting = undefined;
      reject(error);
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.buffered.length > 0) {
          return Promise.resolve({ value: this.buffered.shift() as T, done: false });
        }
        if (this.done) {
          return this.error !== undefined
            ? Promise.reject(this.error)
            : Promise.resolve({ value: undefined as never, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve, reject) => {
          this.waiting = { resolve, reject };
        });
      }
    };
  }
}
