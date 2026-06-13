import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteStateStore } from "../src/repository/sqlite-state-store";
import { MemorySecretStore } from "../src/secrets/secret-store";
import { WebSearchConfigService } from "../src/web-search/web-search-config-service";

describe("WebSearchConfigService", () => {
  let dir: string;
  let store: SqliteStateStore;
  let secrets: MemorySecretStore;
  let service: WebSearchConfigService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cxb-web-search-"));
    store = new SqliteStateStore(join(dir, "state.sqlite"));
    await store.initialize();
    secrets = new MemorySecretStore();
    service = new WebSearchConfigService(store, secrets);
  });

  afterEach(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("returns defaults when nothing is stored or the value is corrupt", async () => {
    await expect(service.load()).resolves.toEqual({ enabled: false });

    await store.setSetting("web-search", "{not json");
    await expect(service.load()).resolves.toEqual({ enabled: false });
  });

  it("stores Tavily API Key in the secret store, never in settings", async () => {
    const config = await service.save({ enabled: true, apiKey: "tvly-secret" });

    expect(config).toMatchObject({
      enabled: true,
      apiKeyRef: "memory:web-search:tavily"
    });
    const raw = await store.getSetting("web-search");
    expect(raw).not.toContain("tvly-secret");
    expect(raw).toContain("memory:web-search:tavily");
    await expect(service.getApiKey(config)).resolves.toBe("tvly-secret");
  });

  it("keeps the existing key when saving with an empty key field", async () => {
    await service.save({ enabled: true, apiKey: "first-key" });

    const updated = await service.save({ enabled: true, apiKey: "" });

    expect(updated.apiKeyRef).toBe("memory:web-search:tavily");
    await expect(service.getApiKey(updated)).resolves.toBe("first-key");
  });

  it("rejects enabling without a stored or new key", async () => {
    await expect(service.save({ enabled: true })).rejects.toThrow("Tavily API Key");
  });

  it("does not register a searcher while disabled", async () => {
    await service.save({ enabled: false, apiKey: "stored-key" });

    await expect(service.createSearcher()).resolves.toBeUndefined();
  });
});
