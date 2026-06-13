import type { AppEvent } from "@chengxiaobang/shared";
import type { AgentRunner } from "../agent/agent-runner";
import type { EventHub } from "../events/event-hub";
import type { FeishuConfigService } from "../feishu/feishu-config-service";
import type { FeishuService } from "../feishu/feishu-service";
import type { ProviderService } from "../model/provider-service";
import type { StateStore } from "../repository/state-store";
import type { SkillMarketService } from "../tools/skill-market-service";
import type { TaskScheduler } from "../tasks/task-scheduler";
import type { SlashCommandService } from "../tools/slash-command-service";
import type { WebSearchConfigService } from "../web-search/web-search-config-service";

export interface AppOptions {
  token?: string;
  store: StateStore;
  providerService: ProviderService;
  runner: AgentRunner;
  slashCommandService?: SlashCommandService;
  skillMarketService?: SkillMarketService;
  feishuConfigService?: FeishuConfigService;
  feishuService?: FeishuService;
  webSearchConfigService?: WebSearchConfigService;
  taskScheduler?: TaskScheduler;
  eventHub?: EventHub<AppEvent>;
}

export type AppContext = AppOptions & {
  slashCommandService: SlashCommandService;
  eventHub: EventHub<AppEvent>;
};
