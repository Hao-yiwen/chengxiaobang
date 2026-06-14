import type { ProviderConfig } from "@chengxiaobang/shared";

export function isConfiguredProvider(provider: ProviderConfig | undefined): provider is ProviderConfig {
  return Boolean(provider?.apiKeyRef);
}

export function firstConfiguredProvider(providers: ProviderConfig[]): ProviderConfig | undefined {
  return providers.find(isConfiguredProvider);
}

export function configuredProviderById(
  providers: ProviderConfig[],
  id: string | undefined
): ProviderConfig | undefined {
  if (!id) {
    return undefined;
  }
  const provider = providers.find((item) => item.id === id);
  return isConfiguredProvider(provider) ? provider : undefined;
}
