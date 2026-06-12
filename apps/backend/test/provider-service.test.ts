import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderService } from "../src/model/provider-service";
import { SqliteStateStore } from "../src/repository/sqlite-state-store";
import { MemorySecretStore } from "../src/secrets/secret-store";

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
    const service = new ProviderService(store, secrets, vi.fn());

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

  it("resolves the stored key and delegates connectivity tests", async () => {
    const secrets = new MemorySecretStore();
    const probe = vi.fn().mockResolvedValue(undefined);
    const service = new ProviderService(store, secrets, probe);
    const provider = await service.saveProvider({
      id: "deepseek",
      kind: "deepseek",
      name: "DeepSeek",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      apiKey: "secret-key"
    });

    await service.testProvider(provider.id);

    expect(probe).toHaveBeenCalledWith(
      expect.objectContaining({ id: "deepseek" }),
      "secret-key"
    );
    await expect(service.testProvider("missing")).rejects.toThrow("模型配置不存在");
  });
});
