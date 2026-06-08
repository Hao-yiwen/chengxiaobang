import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nowIso, type ProviderConfig, type StreamEvent } from "@chengxiaobang/shared";
import { AgentRunner } from "../src/agent/agent-runner";
import type { ModelClient, ModelDelta } from "../src/model/openai-compatible";
import { SqliteStateStore } from "../src/repository/sqlite-state-store";
import { MemorySecretStore } from "../src/secrets/secret-store";

/** A scripted model: each call yields the next pre-baked sequence of deltas. */
function scriptedModel(turns: ModelDelta[][]): ModelClient {
  let index = 0;
  return {
    async *streamCompletion() {
      const turn = turns[Math.min(index, turns.length - 1)];
      index += 1;
      for (const delta of turn) {
        yield delta;
      }
    },
    async testProvider() {}
  };
}

async function drain(stream: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

describe("AgentRunner agentic loop", () => {
  let dir: string;
  let store: SqliteStateStore;
  let secrets: MemorySecretStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cxb-loop-"));
    store = new SqliteStateStore(join(dir, "state.sqlite"));
    await store.initialize();
    secrets = new MemorySecretStore();
    const apiKeyRef = await secrets.setSecret("deepseek", "test-key");
    const provider: ProviderConfig = {
      id: "deepseek",
      kind: "deepseek",
      name: "DeepSeek",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      apiKeyRef,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    await store.upsertProvider(provider);
  });

  afterEach(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("executes a model-requested tool then produces a final answer with usage", async () => {
    const project = await store.createProject({ name: "proj", path: dir });
    const model = scriptedModel([
      [
        {
          type: "tool_calls",
          toolCalls: [
            {
              id: "call_1",
              name: "write_file",
              arguments: JSON.stringify({ path: "out.txt", content: "done" })
            }
          ]
        }
      ],
      [
        { type: "text", delta: "已经写好文件。" },
        { type: "usage", usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } }
      ]
    ]);
    const runner = new AgentRunner(store, secrets, model);

    const events = await drain(
      runner.stream({ prompt: "把内容写入 out.txt", projectId: project.id, accessMode: "full_access" })
    );

    const types = events.map((event) => event.type);
    expect(types).toContain("tool_call_started");
    expect(types).toContain("tool_result");
    expect(types).toContain("assistant_done");
    expect(types).toContain("run_completed");
    const completed = events.find((event) => event.type === "run_completed");
    expect(completed?.type === "run_completed" && completed.usage?.totalTokens).toBe(15);
    await expect(readFile(join(dir, "out.txt"), "utf8")).resolves.toBe("done");
  });

  it("waits for approval before running a model-requested mutating tool", async () => {
    const project = await store.createProject({ name: "proj", path: dir });
    const model = scriptedModel([
      [
        {
          type: "tool_calls",
          toolCalls: [
            { id: "call_1", name: "write_file", arguments: JSON.stringify({ path: "a.txt", content: "x" }) }
          ]
        }
      ],
      [{ type: "text", delta: "好的。" }]
    ]);
    const runner = new AgentRunner(store, secrets, model);
    const stream = runner.stream({
      prompt: "写文件",
      projectId: project.id,
      accessMode: "approval"
    });

    const collected: StreamEvent[] = [];
    for await (const event of stream) {
      collected.push(event);
      if (event.type === "tool_call_pending") {
        runner.approvals.decide(event.toolCall.id, true);
      }
    }
    expect(collected.some((event) => event.type === "tool_call_pending")).toBe(true);
    expect(collected.some((event) => event.type === "run_completed")).toBe(true);
    await expect(readFile(join(dir, "a.txt"), "utf8")).resolves.toBe("x");
  });

  it("feeds tool failures back to the model instead of aborting", async () => {
    const project = await store.createProject({ name: "proj", path: dir });
    const model = scriptedModel([
      [
        {
          type: "tool_calls",
          toolCalls: [
            { id: "call_1", name: "read_file", arguments: JSON.stringify({ path: "missing.txt" }) }
          ]
        }
      ],
      [{ type: "text", delta: "文件不存在，已说明。" }]
    ]);
    const runner = new AgentRunner(store, secrets, model);

    const events = await drain(
      runner.stream({ prompt: "读文件", projectId: project.id, accessMode: "full_access" })
    );

    const toolResult = events.find((event) => event.type === "tool_result");
    expect(toolResult?.type === "tool_result" && toolResult.toolCall.status).toBe("failed");
    // The run still completes because the failure is handed back to the model.
    expect(events.some((event) => event.type === "run_completed")).toBe(true);
    expect(events.some((event) => event.type === "run_error")).toBe(false);
  });
});
