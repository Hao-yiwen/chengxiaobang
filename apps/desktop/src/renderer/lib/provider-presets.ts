import type { ProviderInput } from "@chengxiaobang/shared";

/** Default form values for each provider kind, shared by the setup dialog and settings. */
export const PROVIDER_PRESETS: Record<ProviderInput["kind"], Omit<ProviderInput, "apiKey">> = {
  deepseek: {
    kind: "deepseek",
    name: "DeepSeek",
    baseURL: "https://api.deepseek.com",
    model: "deepseek-v4-flash"
  },
  kimi: {
    kind: "kimi",
    name: "Kimi",
    baseURL: "https://api.moonshot.ai/v1",
    model: "kimi-k2.6"
  },
  minimax: {
    kind: "minimax",
    name: "MiniMax",
    baseURL: "https://api.minimaxi.com/v1",
    model: "MiniMax-M3"
  },
  doubao: {
    kind: "doubao",
    name: "豆包",
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
    model: "doubao-seed-1-6-250615"
  },
  qwen: {
    kind: "qwen",
    name: "千问",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus"
  },
  "openai-compatible": {
    kind: "openai-compatible",
    name: "OpenAI-compatible",
    baseURL: "https://api.openai.com/v1",
    model: "gpt-4.1"
  },
  custom: {
    kind: "custom",
    name: "Custom",
    baseURL: "https://api.example.com/v1",
    // 自定义供应商没有可预知的模型，留空由用户自行添加。
    model: ""
  }
};

export const API_KEY_URLS: Partial<Record<ProviderInput["kind"], string>> = {
  deepseek: "https://platform.deepseek.com/api_keys",
  kimi: "https://platform.kimi.ai/console/api-keys",
  minimax: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
  doubao: "https://console.volcengine.com/ark",
  qwen: "https://bailian.console.aliyun.com/?apiKey=1",
  "openai-compatible": "https://platform.openai.com/api-keys"
};

/** Display order + labels for the provider pickers (setup dialog & settings). */
export const PROVIDER_KIND_OPTIONS: { value: ProviderInput["kind"]; label: string }[] = [
  { value: "deepseek", label: "DeepSeek" },
  { value: "kimi", label: "Kimi" },
  { value: "minimax", label: "MiniMax" },
  { value: "doubao", label: "豆包" },
  { value: "qwen", label: "千问" },
  { value: "openai-compatible", label: "OpenAI-compatible" },
  { value: "custom", label: "自定义" }
];
