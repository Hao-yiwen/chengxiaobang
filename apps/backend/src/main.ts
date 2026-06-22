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
import { McpManager } from "./mcp/mcp-manager";
import { PluginService } from "./tools/plugin-service";
import { SkillMarketService } from "./tools/skill-market-service";
import { TaskScheduler } from "./tasks/task-scheduler";
import { createAgentTools } from "./tools/registry";
import { SlashCommandService } from "./tools/slash-command-service";
import { UsageCostLedgerService } from "./usage/usage-cost-ledger";
import { WebSearchConfigService } from "./web-search/web-search-config-service";
import { WechatBridgeRuntime } from "./wechat/wechat-bridge";
import { WechatConfigService } from "./wechat/wechat-config-service";
import { WechatService } from "./wechat/wechat-service";
import { defaultDataDir, defaultProviderConfigPath } from "./paths";

import { getLogger } from "./logging/logger";

const log = getLogger({ module: "main" });

export interface BackendConfig {
  port: number;
  dataDir: string;
  providerConfigPath?: string;
  ocrServiceUrl?: string;
  ocrServiceToken?: string;
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
    log.warn("[backend] 未提供访问 token，已生成本次进程临时 token");
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
  const pluginService = new PluginService(store);
  const skillMarketService = new SkillMarketService(store, {
    enabledPluginRoots: () => pluginService.enabledPluginRoots()
  });
  const slashCommandService = new SlashCommandService(undefined, undefined, {
    enabledMarketSkills: () => skillMarketService.enabledMarketSkillNames(),
    enabledPluginRoots: () => pluginService.enabledPluginRoots(),
    disabledSkills: () => skillMarketService.disabledSkillNames(),
    disabledCommands: () => skillMarketService.disabledCommandNames()
  });
  // MCP 桥接：懒加载已启用插件声明的 MCP server，把其工具注入 agent 工具集合。
  const mcpManager = new McpManager({
    dataDir: config.dataDir,
    enabledPluginRoots: () => pluginService.enabledPluginRoots(),
    getUserConfig: async (pluginName) => {
      const values = await pluginService.getConfigValues(pluginName);
      return Object.fromEntries(
        Object.entries(values).map(([key, value]) => [key, String(value)])
      );
    }
  });
  const webSearchConfigService = new WebSearchConfigService(store, secrets);
  // Lazily resolved: the FeishuService is constructed after the runner
  // (it consumes the runner), so the tools reach it through a closure.
  let feishuServiceRef: FeishuService | undefined;
  // 长期记忆与 SQLite 同级落在 data-dir 下，跨所有会话共享。
  const memoryDir = join(config.dataDir, "memories");
  log.info(`[backend] 长期记忆目录 ${memoryDir}`);
  const runner = new AgentRunner(store, secrets, {
    providerRepository: providerConfigFile,
    memoryDir,
    createTools: async (workspacePath) =>
      createAgentTools(workspacePath, {
        getFeishuSender: () => feishuServiceRef?.getSender(),
        webSearch: await webSearchConfigService.createSearcher(),
        memoryDir,
        skillMarketService,
        mcpTools: await mcpManager.getToolsForWorkspace(workspacePath),
        ...(config.ocrServiceUrl && config.ocrServiceToken
          ? { ocr: { serviceUrl: config.ocrServiceUrl, token: config.ocrServiceToken } }
          : {})
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
  const wechatConfigService = new WechatConfigService(store);
  const wechatService = new WechatService({
    configService: wechatConfigService,
    store,
    runner,
    bridge: new WechatBridgeRuntime({ dataDir: config.dataDir })
  });
  await wechatService.start();
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
      pluginService,
      feishuConfigService,
      feishuInstallService,
      feishuService,
      wechatConfigService,
      wechatService,
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
      await mcpManager.shutdown();
      await wechatService.stop();
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
    ocrServiceUrl: args.get("ocr-service-url") ?? env.CHENGXIAOBANG_OCR_SERVICE_URL,
    ocrServiceToken: args.get("ocr-service-token") ?? env.CHENGXIAOBANG_OCR_SERVICE_TOKEN,
    token: args.get("token") ?? env.CHENGXIAOBANG_TOKEN,
    parentPid: parseOptionalPositiveInteger(
      args.get("parent-pid") ?? env.CHENGXIAOBANG_PARENT_PID
    )
  };
}

if (isCliEntry()) {
  const config = readCliConfig();
  const backend = await startBackend(config);
  log.info("后端启动完成", {
    action: "backend.started",
    ok: true,
    port: backend.port,
    token: backend.token
  });
  let shuttingDown = false;
  let parentWatchdog: ParentProcessWatchdog | undefined;
  // Bun.serve 在部分直接启动场景下不会单独保持 CLI 进程，保留显式句柄避免启动后退出。
  const keepAlive = setInterval(() => {}, 60_000);
  const shutdown = async (reason = "shutdown") => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    parentWatchdog?.stop();
    clearInterval(keepAlive);
    log.info(`[backend] 开始关闭 reason=${reason}`);
    try {
      await backend.close();
    } catch (error) {
      log.error(`[backend] 关闭失败 reason=${reason}: ${messageFromError(error)}`);
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
  log.info(`[backend] 父进程 watchdog 启动 parentPid=${parentPid} intervalMs=${intervalMs}`);
  const timer = setInterval(() => {
    if (isProcessAlive(parentPid, killProcess)) {
      return;
    }
    log.warn(`[backend] 父进程已不可用 parentPid=${parentPid}，准备关闭后端`);
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
