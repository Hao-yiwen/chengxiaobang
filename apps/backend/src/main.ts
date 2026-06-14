import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import type { AppEvent } from "@chengxiaobang/shared";
import { AgentRunner } from "./agent/agent-runner";
import { createApp } from "./api/app";
import { EventHub } from "./events/event-hub";
import { createLarkBridge } from "./feishu/feishu-bridge";
import { FeishuConfigService } from "./feishu/feishu-config-service";
import { FeishuInstallService } from "./feishu/feishu-install-service";
import { FeishuService } from "./feishu/feishu-service";
import { ProviderConfigFileService } from "./model/provider-config-file";
import { ProviderService } from "./model/provider-service";
import { SqliteStateStore } from "./repository/sqlite-state-store";
import { createSecretStore } from "./secrets/secret-store";
import { startServer } from "./server";
import { SkillMarketService } from "./tools/skill-market-service";
import { TaskScheduler } from "./tasks/task-scheduler";
import { createAgentTools } from "./tools/registry";
import { SlashCommandService } from "./tools/slash-command-service";
import { UsageCostLedgerService } from "./usage/usage-cost-ledger";
import { WebSearchConfigService } from "./web-search/web-search-config-service";
import { defaultDataDir, defaultProviderConfigPath } from "./paths";

export interface BackendConfig {
  port: number;
  dataDir: string;
  providerConfigPath?: string;
  token?: string;
  parentPid?: number;
}

export interface ParentProcessWatchdog {
  stop(): void;
}

export interface ParentProcessWatchdogOptions {
  intervalMs?: number;
  killProcess?: (pid: number, signal: NodeJS.Signals | 0) => void;
  onParentLost: (reason: string) => void | Promise<void>;
}

const PARENT_PROCESS_WATCHDOG_INTERVAL_MS = 1_000;

export async function startBackend(config: BackendConfig) {
  await mkdir(config.dataDir, { recursive: true });
  const authToken = config.token ?? randomUUID();
  if (!config.token) {
    console.warn("[backend] 未提供访问 token，已生成本次进程临时 token");
  }
  const store = new SqliteStateStore(join(config.dataDir, "chengxiaobang.sqlite"));
  await store.initialize();
  const secrets = createSecretStore();
  const providerConfigFile = new ProviderConfigFileService(
    config.providerConfigPath ?? defaultProviderConfigPath()
  );
  await providerConfigFile.initialize();
  const providerService = new ProviderService(providerConfigFile, secrets);
  const usageCostLedgerService = new UsageCostLedgerService(store);
  const skillMarketService = new SkillMarketService(store);
  const slashCommandService = new SlashCommandService(undefined, undefined, {
    enabledMarketSkills: () => skillMarketService.enabledMarketSkillNames()
  });
  const webSearchConfigService = new WebSearchConfigService(store, secrets);
  // Lazily resolved: the FeishuService is constructed after the runner
  // (it consumes the runner), so the tools reach it through a closure.
  let feishuServiceRef: FeishuService | undefined;
  // 长期记忆与 SQLite 同级落在 data-dir 下，跨所有会话共享。
  const memoryDir = join(config.dataDir, "memories");
  console.info(`[backend] 长期记忆目录 ${memoryDir}`);
  const runner = new AgentRunner(store, secrets, {
    providerRepository: providerConfigFile,
    memoryDir,
    createTools: async (workspacePath) =>
      createAgentTools(workspacePath, {
        getFeishuSender: () => feishuServiceRef?.getSender(),
        webSearch: await webSearchConfigService.createSearcher(),
        memoryDir,
        skillMarketService
      }),
    slashCommandService,
    usageCostLedgerService
  });
  const feishuConfigService = new FeishuConfigService(store, secrets);
  const feishuInstallService = new FeishuInstallService();
  const feishuService = new FeishuService({
    configService: feishuConfigService,
    store,
    runner,
    bridgeFactory: createLarkBridge
  });
  feishuServiceRef = feishuService;
  await feishuService.start();
  const eventHub = new EventHub<AppEvent>();
  const taskScheduler = new TaskScheduler({ store, runner, eventHub });
  taskScheduler.start();

  const server = await startServer({
    port: config.port,
    fetch: createApp({
      token: authToken,
      store,
      providerService,
      runner,
      slashCommandService,
      skillMarketService,
      feishuConfigService,
      feishuInstallService,
      feishuService,
      webSearchConfigService,
      usageCostLedgerService,
      taskScheduler,
      eventHub
    })
  });
  return {
    port: server.port,
    token: authToken,
    close: async () => {
      // 先停调度器并中止在飞行的调度 run，避免向已关闭的 store 写入。
      await taskScheduler.stop();
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
    providerConfigPath:
      args.get("provider-config") ?? env.CHENGXIAOBANG_PROVIDER_CONFIG ?? defaultProviderConfigPath(),
    token: args.get("token") ?? env.CHENGXIAOBANG_TOKEN,
    parentPid: parseOptionalPositiveInteger(
      args.get("parent-pid") ?? env.CHENGXIAOBANG_PARENT_PID
    )
  };
}

if (isCliEntry()) {
  const config = readCliConfig();
  const backend = await startBackend(config);
  console.log(JSON.stringify({ ok: true, port: backend.port, token: backend.token }));
  let shuttingDown = false;
  let parentWatchdog: ParentProcessWatchdog | undefined;
  const shutdown = async (reason = "shutdown") => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    parentWatchdog?.stop();
    console.info(`[backend] 开始关闭 reason=${reason}`);
    try {
      await backend.close();
    } catch (error) {
      console.error(`[backend] 关闭失败 reason=${reason}: ${messageFromError(error)}`);
    } finally {
      process.exit(0);
    }
  };
  parentWatchdog = startParentProcessWatchdog(config.parentPid, {
    onParentLost: shutdown
  });
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

export function startParentProcessWatchdog(
  parentPid: number | undefined,
  options: ParentProcessWatchdogOptions
): ParentProcessWatchdog | undefined {
  if (!parentPid || parentPid <= 1) {
    return undefined;
  }
  const intervalMs = options.intervalMs ?? PARENT_PROCESS_WATCHDOG_INTERVAL_MS;
  const killProcess = options.killProcess ?? process.kill;
  console.info(`[backend] 父进程 watchdog 启动 parentPid=${parentPid} intervalMs=${intervalMs}`);
  const timer = setInterval(() => {
    if (isProcessAlive(parentPid, killProcess)) {
      return;
    }
    console.warn(`[backend] 父进程已不可用 parentPid=${parentPid}，准备关闭后端`);
    clearInterval(timer);
    void options.onParentLost("parent-lost");
  }, intervalMs);
  timer.unref?.();
  return {
    stop: () => clearInterval(timer)
  };
}

function isProcessAlive(
  pid: number,
  killProcess: (pid: number, signal: NodeJS.Signals | 0) => void
): boolean {
  try {
    killProcess(pid, 0);
    return true;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    return code !== "ESRCH";
  }
}

function parseOptionalPositiveInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCliEntry(): boolean {
  const entry = process.argv[1];
  return entry ? import.meta.url === pathToFileURL(resolve(entry)).href : false;
}
