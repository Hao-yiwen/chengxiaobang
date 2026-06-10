import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AgentRunner } from "./agent/agent-runner";
import { createApp } from "./api/app";
import { createLarkBridge } from "./feishu/feishu-bridge";
import { FeishuConfigService } from "./feishu/feishu-config-service";
import { FeishuService } from "./feishu/feishu-service";
import { OpenAICompatibleModelClient } from "./model/openai-compatible";
import { loadPiRuntime } from "./model/pi-runtime";
import { ProviderService } from "./model/provider-service";
import { SqliteStateStore } from "./repository/sqlite-state-store";
import { createSecretStore } from "./secrets/secret-store";
import { startServer } from "./server";
import { SlashCommandService } from "./tools/slash-command-service";
import { defaultDataDir, defaultSessionDir } from "./paths";

export interface BackendConfig {
  port: number;
  dataDir: string;
  token?: string;
}

export async function startBackend(config: BackendConfig) {
  await mkdir(config.dataDir, { recursive: true });
  const store = new SqliteStateStore(join(config.dataDir, "chengxiaobang.sqlite"));
  await store.initialize();
  const secrets = createSecretStore();
  const modelClient = new OpenAICompatibleModelClient();
  const providerService = new ProviderService(store, secrets, modelClient);
  const slashCommandService = new SlashCommandService();
  const runner = new AgentRunner(
    store,
    secrets,
    modelClient,
    undefined,
    defaultSessionDir,
    slashCommandService
  );
  const piRuntime = await loadPiRuntime();
  if (!piRuntime.available) {
    console.warn(`[chengxiaobang] pi runtime adapter unavailable: ${piRuntime.error}`);
  }
  const feishuConfigService = new FeishuConfigService(store, secrets);
  const feishuService = new FeishuService({
    configService: feishuConfigService,
    store,
    runner,
    bridgeFactory: createLarkBridge
  });
  await feishuService.start();

  const server = await startServer({
    port: config.port,
    fetch: createApp({
      token: config.token,
      store,
      providerService,
      runner,
      slashCommandService,
      feishuConfigService,
      feishuService
    })
  });
  return {
    port: server.port,
    close: async () => {
      await feishuService.stop();
      await server.close();
      await store.close();
    }
  };
}

export function readCliConfig(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): BackendConfig {
  const args = new Map<string, string>();
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith("--")) {
      args.set(arg.slice(2), argv[index + 1] ?? "");
      index += 1;
    }
  }
  return {
    port: Number(args.get("port") ?? env.PORT ?? 0),
    dataDir: args.get("data-dir") ?? env.CHENGXIAOBANG_DATA_DIR ?? defaultDataDir(),
    token: args.get("token") ?? env.CHENGXIAOBANG_TOKEN
  };
}

if (isCliEntry()) {
  const backend = await startBackend(readCliConfig());
  console.log(JSON.stringify({ ok: true, port: backend.port }));
  const shutdown = async () => {
    await backend.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

function isCliEntry(): boolean {
  const entry = process.argv[1];
  return entry ? import.meta.url === pathToFileURL(resolve(entry)).href : false;
}
