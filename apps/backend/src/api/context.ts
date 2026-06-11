import type { AgentRunner } from "../agent/agent-runner";
import type { FeishuConfigService } from "../feishu/feishu-config-service";
import type { FeishuService } from "../feishu/feishu-service";
import type { ProviderService } from "../model/provider-service";
import type { StateStore } from "../repository/state-store";
import type { SlashCommandService } from "../tools/slash-command-service";

export interface AppOptions {
  token?: string;
  store: StateStore;
  providerService: ProviderService;
  runner: AgentRunner;
  slashCommandService?: SlashCommandService;
  feishuConfigService?: FeishuConfigService;
  feishuService?: FeishuService;
}

export type AppContext = AppOptions & {
  slashCommandService: SlashCommandService;
};
