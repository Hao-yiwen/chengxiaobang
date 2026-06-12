import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AgentRunner } from "./agent/agent-runner";
import { createApp } from "./api/app";
import { createLarkBridge } from "./feishu/feishu-bridge";
import { FeishuConfigService } from "./feishu/feishu-config-service";
import { FeishuService } from "./feishu/feishu-service";
import { ProviderService } from "./model/provider-service";
import { SqliteStateStore } from "./repository/sqlite-state-store";
import { createSecretStore } from "./secrets/secret-store";
import { startServer } from "./server";
import { TaskScheduler } from "./tasks/task-scheduler";
import { createAgentTools } from "./tools/registry";
import { SlashCommandService } from "./tools/slash-command-service";
import { defaultDataDir } from "./paths";

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
  const providerService = new ProviderService(store, secrets);
  const slashCommandService = new SlashCommandService();
  // Lazily resolved: the FeishuService is constructed after the runner
  // (it consumes the runner), so the tools reach it through a closure.
  let feishuServiceRef: FeishuService | undefined;
  const runner = new AgentRunner(store, secrets, {
    createTools: (workspacePath) =>
      createAgentTools(workspacePath, () => feishuServiceRef?.getSender()),
    slashCommandService
  });
  const feishuConfigService = new FeishuConfigService(store, secrets);
  const feishuService = new FeishuService({
    configService: feishuConfigService,
    store,
    runner,
    bridgeFactory: createLarkBridge
  });
  feishuServiceRef = feishuService;
  await feishuService.start();
  const taskScheduler = new TaskScheduler({ store, runner });
  taskScheduler.start();

  const server = await startServer({
    port: config.port,
    fetch: createApp({
      token: config.token,
      store,
      providerService,
      runner,
      slashCommandService,
      feishuConfigService,
      feishuService,
      taskScheduler
    })
  });
  return {
    port: server.port,
    close: async () => {
      // 先停调度器并中止在飞行的调度 run，避免向已关闭的 store 写入。
      taskScheduler.stop();
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
