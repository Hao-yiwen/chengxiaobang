import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProviderConfig, Session, TokenUsage } from "@chengxiaobang/shared";
import { SqliteStateStore } from "../src/repository/sqlite-state-store";
import type { UsageCostAttempt } from "../src/usage/usage-cost-ledger";
import { UsageCostLedgerService } from "../src/usage/usage-cost-ledger";

const provider: ProviderConfig = {
  id: "deepseek",
  kind: "deepseek",
  name: "DeepSeek",
  baseURL: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  api: "openai-completions",
  createdAt: "2026-06-13T00:00:00.000Z",
  updatedAt: "2026-06-13T00:00:00.000Z"
};

describe("UsageCostLedgerService", () => {
  let dir: string;
  let store: SqliteStateStore;
  let ledger: UsageCostLedgerService;
  let session: Session;
  let runSeq = 0;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cxb-usage-ledger-"));
    store = new SqliteStateStore(join(dir, "state.sqlite"));
    await store.initialize();
    await store.upsertProvider(provider);
    session = await store.createSession({
      projectId: null,
      title: "费用测试",
      providerId: provider.id,
      accessMode: "approval"
    });
    ledger = new UsageCostLedgerService(store, {
      countInputTokens: () => ({ tokens: 1_000_000, source: "js_tiktoken" })
    });
  });

  afterEach(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("records successful usage and serves session cost from the ledger", async () => {
    const attempt = await startAttempt();
    const usage: TokenUsage = {
      promptTokens: 1_000_000,
      completionTokens: 500_000,
      totalTokens: 1_500_000
    };

    const entry = await ledger.finishAttemptWithUsage({ attempt, usage });

    expect(entry).toMatchObject({
      runId: attempt.runId,
      attemptIndex: 0,
      promptTokens: 1_000_000,
      completionTokens: 500_000,
      totalTokens: 1_500_000,
      costSource: "catalog_usage",
      tokenCountSource: "provider_usage",
      billable: true
    });
    expect(entry.costCny).toBeGreaterThan(0);
    await expect(ledger.getSessionCostCny(session.id)).resolves.toBe(entry.costCny);
  });

  it("uses provider usage even when the attempt later represents an error outcome", async () => {
    const attempt = await startAttempt();
    ledger.recordResponse(attempt, { statusCode: 500, receivedResponse: true });

    const entry = await ledger.finishAttemptWithUsage({
      attempt,
      usage: {
        promptTokens: 8_000,
        completionTokens: 2_000,
        totalTokens: 10_000,
        costUsd: 0.05
      }
    });

    expect(entry.costSource).toBe("reported_usage");
    expect(entry.statusCode).toBe(500);
    expect(entry.costUsd).toBe(0.05);
    expect(entry.billable).toBe(true);
  });

  it("does not charge explicitly non-billable errors without usage", async () => {
    for (const statusCode of [401, 403, 429, 502, 503, 504]) {
      const attempt = await startAttempt();
      ledger.recordResponse(attempt, { statusCode, receivedResponse: true });

      const entry = await ledger.finishAttemptWithError({
        attempt,
        stopReason: "error",
        errorMessage: `HTTP ${statusCode}`
      });

      expect(entry).toMatchObject({
        statusCode,
        errorCode: `http_${statusCode}`,
        promptTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        costCny: 0,
        costSource: "non_billable_error",
        billable: false
      });
    }

    const networkAttempt = await startAttempt();
    const networkEntry = await ledger.finishAttemptWithError({
      attempt: networkAttempt,
      stopReason: "error",
      errorMessage: "fetch failed: ECONNREFUSED"
    });

    expect(networkEntry).toMatchObject({
      errorCode: "network_error",
      costSource: "non_billable_error",
      billable: false,
      costCny: 0
    });
  });

  it("estimates billable no-usage abort, context limit, and unknown upstream errors", async () => {
    const aborted = await finishBillableError({
      stopReason: "aborted",
      errorMessage: "用户中止运行",
      signalAborted: true
    });
    expect(aborted.errorCode).toBe("user_aborted");

    const contextLimit = await finishBillableError({
      stopReason: "error",
      errorMessage: "context length exceeded"
    });
    expect(contextLimit.errorCode).toBe("context_limit");

    const unknown = await finishBillableError({
      stopReason: "error",
      errorMessage: "upstream internal error",
      statusCode: 500
    });
    expect(unknown.errorCode).toBe("upstream_error");
    expect(unknown.statusCode).toBe(500);

    for (const entry of [aborted, contextLimit, unknown]) {
      expect(entry.costSource).toBe("input_estimate_error");
      expect(entry.billable).toBe(true);
      expect(entry.promptTokens).toBe(entry.inputEstimatedTokens);
      expect(entry.totalTokens).toBe(entry.inputEstimatedTokens);
      expect(entry.costCny).toBeGreaterThan(0);
    }
  });

  it("aggregates multiple attempts while counting distinct runs once", async () => {
    const runId = await createRun();
    const first = await startAttempt({ runId, attemptIndex: 0, prompt: "第一次请求" });
    const second = await startAttempt({ runId, attemptIndex: 1, prompt: "第二次请求" });

    await ledger.finishAttemptWithUsage({
      attempt: first,
      usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 }
    });
    await ledger.finishAttemptWithUsage({
      attempt: second,
      usage: { promptTokens: 300, completionTokens: 400, totalTokens: 700 }
    });

    const stats = await ledger.buildUsageStats({
      timezoneOffsetMinutes: -480,
      now: new Date()
    });

    expect(stats.total.runCount).toBe(1);
    expect(stats.total.usageRunCount).toBe(1);
    expect(stats.total.promptTokens).toBe(400);
    expect(stats.total.completionTokens).toBe(600);
    expect(stats.total.totalTokens).toBe(1_000);
    expect(stats.topModels[0]).toMatchObject({
      providerKind: "deepseek",
      model: "deepseek-v4-flash",
      runCount: 1,
      totalTokens: 1_000
    });
  });

  async function finishBillableError(input: {
    stopReason: "error" | "aborted";
    errorMessage: string;
    statusCode?: number;
    signalAborted?: boolean;
  }) {
    const attempt = await startAttempt();
    if (input.statusCode !== undefined) {
      ledger.recordResponse(attempt, {
        statusCode: input.statusCode,
        receivedResponse: true
      });
    }
    return ledger.finishAttemptWithError({
      attempt,
      stopReason: input.stopReason,
      errorMessage: input.errorMessage,
      signalAborted: input.signalAborted
    });
  }

  async function startAttempt(input: {
    runId?: string;
    attemptIndex?: number;
    prompt?: string;
  } = {}): Promise<UsageCostAttempt> {
    const runId = input.runId ?? (await createRun());
    return ledger.startAttempt({
      runId,
      sessionId: session.id,
      attemptIndex: input.attemptIndex ?? 0,
      provider,
      inputSnapshot: {
        systemPrompt: "你是程小帮",
        messages: [
          {
            role: "user",
            content: input.prompt ?? "请帮我完成一次较大的模型请求",
            timestamp: Date.now()
          }
        ],
        tools: []
      }
    });
  }

  async function createRun(): Promise<string> {
    const runId = `run_usage_cost_${++runSeq}`;
    await store.createRun({
      id: runId,
      sessionId: session.id,
      status: "running",
      providerId: provider.id,
      providerKind: provider.kind,
      model: provider.model
    });
    return runId;
  }
});
