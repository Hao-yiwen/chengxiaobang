import type { AppEvent } from "@chengxiaobang/shared";
import type { AgentRunner } from "../agent/agent-runner";
import type { EventHub } from "../events/event-hub";
import type { FeishuConfigService } from "../feishu/feishu-config-service";
import type { FeishuInstallService } from "../feishu/feishu-install-service";
import type { FeishuService } from "../feishu/feishu-service";
import type { ProviderService } from "../model/provider-service";
import type { StateStore } from "../repository/state-store";
import type { PluginService } from "../tools/plugin-service";
import type { SkillMarketService } from "../tools/skill-market-service";
import type { TaskScheduler } from "../tasks/task-scheduler";
import type { SlashCommandService } from "../tools/slash-command-service";
import type { UsageCostLedgerService } from "../usage/usage-cost-ledger";
import type { WebSearchConfigService } from "../web-search/web-search-config-service";
import type { WechatConfigService } from "../wechat/wechat-config-service";
import type { WechatService } from "../wechat/wechat-service";

export interface AppOptions {
  token?: string;
  allowUnauthenticated?: boolean;
  store: StateStore;
  providerService: ProviderService;
  runner: AgentRunner;
  slashCommandService?: SlashCommandService;
  skillMarketService?: SkillMarketService;
  pluginService?: PluginService;
  feishuConfigService?: FeishuConfigService;
  feishuInstallService?: FeishuInstallService;
  feishuService?: FeishuService;
  wechatConfigService?: WechatConfigService;
  wechatService?: WechatService;
  webSearchConfigService?: WebSearchConfigService;
  usageCostLedgerService?: UsageCostLedgerService;
  taskScheduler?: TaskScheduler;
  eventHub?: EventHub<AppEvent>;
}

export type AppContext = Omit<AppOptions, "usageCostLedgerService" | "slashCommandService" | "eventHub"> & {
  usageCostLedgerService: UsageCostLedgerService;
  slashCommandService: SlashCommandService;
  eventHub: EventHub<AppEvent>;
};
