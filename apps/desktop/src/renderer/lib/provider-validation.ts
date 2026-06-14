import type { ProviderInput } from "@chengxiaobang/shared";

/** 校验错误对应的 i18n key（与 locales 中 settings.providers.errors.* 一一对应）。 */
export type ProviderErrorKey =
  | "settings.providers.errors.name"
  | "settings.providers.errors.baseURL"
  | "settings.providers.errors.apiKey"
  | "settings.providers.errors.models"
  | "settings.providers.errors.model";

/** 各字段错误对应的 i18n key；无错误时字段缺省。 */
export interface ProviderDraftErrors {
  name?: ProviderErrorKey;
  baseURL?: ProviderErrorKey;
  apiKey?: ProviderErrorKey;
  model?: ProviderErrorKey;
}

export function isValidBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * 保存前的表单校验。`hasStoredKey` 表示该供应商已有保存过的 API Key，
 * 此时密钥输入框留空代表“保持不变”，不视为错误。
 */
export function validateProviderDraft(
  draft: ProviderInput,
  context: { hasStoredKey: boolean }
): ProviderDraftErrors {
  const errors: ProviderDraftErrors = {};
  if (!draft.name.trim()) {
    errors.name = "settings.providers.errors.name";
  }
  if (!isValidBaseUrl(draft.baseURL.trim())) {
    errors.baseURL = "settings.providers.errors.baseURL";
  }
  if (!draft.apiKey?.trim() && !context.hasStoredKey) {
    errors.apiKey = "settings.providers.errors.apiKey";
  }
  if (draft.models) {
    if (draft.models.length === 0) {
      errors.model = "settings.providers.errors.models";
    }
  } else if (!draft.model.trim()) {
    errors.model = "settings.providers.errors.model";
  }
  return errors;
}
