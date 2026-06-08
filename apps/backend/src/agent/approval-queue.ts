export class ApprovalQueue {
  private readonly pending = new Map<string, (approved: boolean) => void>();
  private readonly earlyDecisions = new Map<string, boolean>();

  wait(toolCallId: string, signal: AbortSignal): Promise<boolean> {
    if (this.earlyDecisions.has(toolCallId)) {
      const approved = this.earlyDecisions.get(toolCallId) ?? false;
      this.earlyDecisions.delete(toolCallId);
      return Promise.resolve(approved);
    }
    return new Promise((resolve) => {
      const onAbort = (): void => {
        this.pending.delete(toolCallId);
        resolve(false);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.pending.set(toolCallId, (approved) => {
        signal.removeEventListener("abort", onAbort);
        resolve(approved);
      });
    });
  }

  decide(toolCallId: string, approved: boolean): boolean {
    const resolve = this.pending.get(toolCallId);
    if (!resolve) {
      this.earlyDecisions.set(toolCallId, approved);
      return true;
    }
    this.pending.delete(toolCallId);
    resolve(approved);
    return true;
  }
}
