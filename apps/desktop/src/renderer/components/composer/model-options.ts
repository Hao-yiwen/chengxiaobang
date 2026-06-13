import { mergeProviderModelOptions, resolveProviderModelOption } from "@chengxiaobang/shared";
import type { ProviderConfig, ProviderModelOption } from "@chengxiaobang/shared";

export function withCurrentComposerModel(
  provider: ProviderConfig,
  remoteOptions: ProviderModelOption[] | undefined,
  selectedModel: string | undefined
): ProviderModelOption[] {
  const fallback = mergeProviderModelOptions(provider.kind, provider.models ?? [], provider.model);
  let options = remoteOptions && remoteOptions.length > 0 ? remoteOptions : fallback;
  // 供应商配置了启用模型列表时，菜单只展示启用的模型。
  if (provider.models && provider.models.length > 0) {
    const enabled = new Set(provider.models);
    options = options.filter((option) => enabled.has(option.id));
  }
  const currentModel = selectedModel ?? provider.model;
  if (options.some((option) => option.id === currentModel)) {
    return options;
  }
  return [...options, resolveProviderModelOption(provider.kind, currentModel)];
}

export function modelOptionLabel(option: ProviderModelOption): string {
  return option.label ?? option.id;
}
