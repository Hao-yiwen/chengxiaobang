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
      reasoningMode: "high",
      apiKey: "secret-key"
    });

    expect(JSON.stringify(provider)).not.toContain("secret-key");
    expect(provider.reasoningMode).toBe("high");
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

  it("lists models by resolving the provider and its secret", async () => {
    const secrets = new MemorySecretStore();
    const listModels = vi.fn(async () => ["deepseek-v4-flash", "deepseek-chat"]);
    const service = new ProviderService(store, secrets, vi.fn(), listModels);
    const provider = await service.saveProvider({
      kind: "deepseek",
      name: "DeepSeek",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      apiKey: "secret-key"
    });

    await expect(service.listModels(provider.id)).resolves.toEqual([
      "deepseek-v4-flash",
      "deepseek-chat"
    ]);
    expect(listModels).toHaveBeenCalledWith(
      expect.objectContaining({ id: provider.id, baseURL: "https://api.deepseek.com" }),
      "secret-key"
    );
    await expect(service.listModels("missing")).rejects.toThrow("模型配置不存在");
  });

  it("allows saving provider connection metadata without an API key", async () => {
    const secrets = new MemorySecretStore();
    const service = new ProviderService(store, secrets, vi.fn());

    const provider = await service.saveProvider({
      kind: "deepseek",
      name: "DeepSeek",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-v4-flash"
    });

    expect(provider.apiKeyRef).toBeUndefined();
    await expect(service.testProvider(provider.id)).rejects.toThrow("请先填写 API Key");
  });

  it("keeps the stored key when editing without entering a new one", async () => {
    const secrets = new MemorySecretStore();
    const service = new ProviderService(store, secrets, vi.fn());
    const created = await service.saveProvider({
      id: "deepseek",
      kind: "deepseek",
      name: "DeepSeek",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      apiKey: "secret-key"
    });

    const updated = await service.saveProvider({
      id: "deepseek",
      kind: "deepseek",
      name: "DeepSeek 主力",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-v4-flash"
    });

    expect(updated.name).toBe("DeepSeek 主力");
    expect(updated.apiKeyRef).toBe(created.apiKeyRef);
    expect(await secrets.getSecret(updated.apiKeyRef ?? "")).toBe("secret-key");
  });

  it("persists enabled models and keeps the default model inside the list", async () => {
    const secrets = new MemorySecretStore();
    const service = new ProviderService(store, secrets, vi.fn());

    const provider = await service.saveProvider({
      kind: "deepseek",
      name: "DeepSeek",
      baseURL: "https://api.deepseek.com",
      // 默认模型不在勾选列表里时回退到列表第一个；重复项被去重。
      model: "deepseek-chat",
      models: ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-v4-flash"],
      modelOverrides: {
        "deepseek-v4-flash": { maxToolIterations: 500 },
        "deepseek-v4-pro": { maxToolIterations: 700 },
        "deepseek-chat": { maxToolIterations: 900 }
      },
      apiKey: "secret-key"
    });

    expect(provider.models).toEqual(["deepseek-v4-flash", "deepseek-v4-pro"]);
    expect(provider.model).toBe("deepseek-v4-flash");
    expect(provider.modelOverrides).toEqual({
      "deepseek-v4-flash": { maxToolIterations: 500 },
      "deepseek-v4-pro": { maxToolIterations: 700 }
    });

    const roundTripped = await store.getProvider(provider.id);
    expect(roundTripped?.models).toEqual(["deepseek-v4-flash", "deepseek-v4-pro"]);
    expect(roundTripped?.modelOverrides).toEqual({
      "deepseek-v4-flash": { maxToolIterations: 500 },
      "deepseek-v4-pro": { maxToolIterations: 700 }
    });
  });

  it("lists merged model options with reasoning capabilities", async () => {
    const secrets = new MemorySecretStore();
    const listModels = vi.fn(async () => ["deepseek-v4-pro", "deepseek-live"]);
    const service = new ProviderService(store, secrets, vi.fn(), listModels);
    const provider = await service.saveProvider({
      kind: "deepseek",
      name: "DeepSeek",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      apiKey: "secret-key"
    });

    await expect(service.listModelOptions(provider.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "deepseek-v4-flash",
          reasoningModes: ["off", "high", "xhigh"]
        }),
        expect.objectContaining({ id: "deepseek-v4-pro" }),
        expect.objectContaining({ id: "deepseek-live", source: "live" })
      ])
    );
  });
});
