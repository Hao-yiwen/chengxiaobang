import { ArrowSquareOutIcon as ExternalLink } from "@phosphor-icons/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProviderInput, ProviderKind } from "@chengxiaobang/shared";
import {
  defaultModelIds,
  normalizeModelIds,
  ProviderCascadeSelect,
  ProviderModelTags
} from "@/components/ProviderCascadeSelect";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/Logo";
import { API_KEY_URLS, PROVIDER_KIND_OPTIONS, PROVIDER_PRESETS } from "@/lib/provider-presets";
import { validateProviderDraft } from "@/lib/provider-validation";
import { useAppStore } from "@/store";

/**
 * 首次配置保持克制：选择供应商、粘贴 API Key，然后即可开始对话。
 * 后续更细的模型与供应商设置都可以回到「设置 → 供应商」里调整。
 */
export function SetupDialog() {
  const { t } = useTranslation();
  const open = useAppStore((state) => state.onboardingOpen);
  const setSetupOpen = useAppStore((state) => state.setOnboardingOpen);
  const saveProvider = useAppStore((state) => state.saveProvider);

  const [draft, setDraft] = useState<ProviderInput>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const canSave = Boolean(draft?.apiKey?.trim()) && !saving;

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!draft) {
      setError(t("settings.providers.errors.provider"));
      return;
    }
    if (!canSave) {
      return;
    }
    const validation = validateProviderDraft(draft, { hasStoredKey: false });
    const firstError = Object.values(validation).find(Boolean);
    if (firstError) {
      console.warn("[setup] 首次配置校验未通过", validation);
      setError(t(firstError));
      return;
    }
    setSaving(true);
    setError("");
    try {
      await saveProvider(draft);
    } catch (cause) {
      console.error("首次配置保存供应商失败", cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setSetupOpen}>
      <DialogContent className="max-w-[520px] gap-5 p-7">
        <DialogHeader className="items-start border-b pb-5 text-left sm:text-left">
          <Logo className="mb-3 size-8" />
          <DialogTitle>{t("setup.title")}</DialogTitle>
          <DialogDescription className="leading-relaxed">
            {t("setup.desc")}
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-3.5" onSubmit={onSubmit}>
          <div className="grid gap-1.5">
            <Label className="text-micro text-muted-slate">
              {t("settings.providers.type")}
            </Label>
            <ProviderCascadeSelect
              value={draft?.kind}
              ariaLabel={t("settings.providers.type")}
              options={PROVIDER_KIND_OPTIONS}
              placeholder={t("settings.providers.cascadePlaceholder")}
              selectedModelIds={draft?.models}
              onSelectedModelIdsChange={(modelIds) => {
                if (!draft) {
                  return;
                }
                setDraft(applyDraftModels(draft, modelIds));
                setError("");
              }}
              onValueChange={(kind, modelIds) => {
                console.debug("[setup] 首次配置切换供应商", { kind });
                setDraft(providerDraftFromPreset(kind, { apiKey: draft?.apiKey ?? "", modelIds }));
                setError("");
              }}
            />
          </div>

          {draft ? (
            <>
              <div className="grid gap-1.5">
                <Label className="text-micro text-muted-slate">
                  {t("settings.providers.selectedModels")}
                </Label>
                <ProviderModelTags
                  providerKind={draft.kind}
                  modelIds={draft.models}
                  emptyLabel={t("settings.providers.noModelsSelected")}
                  onRemove={(modelId) => {
                    setDraft(
                      applyDraftModels(
                        draft,
                        (draft.models ?? []).filter((id) => id !== modelId)
                      )
                    );
                    setError("");
                  }}
                />
              </div>

              <div className="grid gap-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-micro text-muted-slate">API Key</Label>
                  {API_KEY_URLS[draft.kind] ? (
                    <a
                      href={API_KEY_URLS[draft.kind]}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-micro text-link underline-offset-2 hover:underline"
                    >
                      <ExternalLink className="size-3" />
                      {t("settings.providers.getApiKey")}
                    </a>
                  ) : null}
                </div>
                <Input
                  autoFocus
                  type="password"
                  placeholder={t("setup.apiKeyPlaceholder")}
                  value={draft.apiKey ?? ""}
                  onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
                />
              </div>

              <div className="grid gap-1.5">
                <Label className="text-micro text-muted-slate">Base URL</Label>
                <Input
                  value={draft.baseURL}
                  onChange={(event) => setDraft({ ...draft, baseURL: event.target.value })}
                />
              </div>
            </>
          ) : null}

          {error ? <p className="text-micro text-destructive">{error}</p> : null}

          <div className="mt-1 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setSetupOpen(false)}
            >
              {t("setup.later")}
            </Button>
            <Button type="submit" size="sm" className="rounded-sm px-4" disabled={!canSave}>
              {saving ? t("setup.saving") : t("setup.save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function providerDraftFromPreset(
  kind: ProviderKind,
  options: { apiKey?: string; modelIds?: string[] } = {}
): ProviderInput {
  const preset = PROVIDER_PRESETS[kind];
  const models = normalizeModelIds(kind, options.modelIds ?? preset.models ?? defaultModelIds(kind));
  return {
    ...preset,
    apiKey: options.apiKey,
    models,
    model: models.includes(preset.model) ? preset.model : models[0] ?? preset.model
  };
}

function applyDraftModels(draft: ProviderInput, modelIds: string[]): ProviderInput {
  const models = normalizeModelIds(draft.kind, modelIds, { allowEmpty: true });
  return {
    ...draft,
    models,
    model: models.includes(draft.model) ? draft.model : models[0] ?? draft.model
  };
}
