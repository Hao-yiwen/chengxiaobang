import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderService } from "../src/model/provider-service";
import { SqliteStateStore } from "../src/repository/sqlite-state-store";
import { MemorySecretStore } from "../src/secrets/secret-store";
import type { ModelClient } from "../src/model/openai-compatible";

describe("ProviderService", () => {
  let dir: string;
  let store: SqliteStateStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cxb-provider-"));
    store = new SqliteStateStore(join(dir, "state.sqlite"));
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("stores API keys in secret store, not provider config", async () => {
    const secrets = new MemorySecretStore();
    const modelClient: ModelClient = {
      streamCompletion: vi.fn() as never,
      testProvider: vi.fn()
    };
    const service = new ProviderService(store, secrets, modelClient);

    const provider = await service.saveProvider({
      kind: "deepseek",
      name: "DeepSeek",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      apiKey: "secret-key"
    });

    expect(JSON.stringify(provider)).not.toContain("secret-key");
    expect(provider.apiKeyRef).toMatch(/^memory:/);
    expect(await secrets.getSecret(provider.apiKeyRef ?? "")).toBe("secret-key");
  });
});
