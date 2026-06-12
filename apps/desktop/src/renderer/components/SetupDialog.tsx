import { ArrowSquareOutIcon as ExternalLink } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  mergeProviderModelOptions,
  type ProviderInput,
  type ProviderModelOption
} from "@chengxiaobang/shared";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Logo } from "@/components/Logo";
import { API_KEY_URLS, PROVIDER_KIND_OPTIONS, PROVIDER_PRESETS } from "@/lib/provider-presets";
import { isCatalogProvider, validateProviderDraft } from "@/lib/provider-validation";
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

  const [draft, setDraft] = useState<ProviderInput>({ ...PROVIDER_PRESETS.deepseek, apiKey: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const modelOptions = useMemo(
    () => mergeProviderModelOptions(draft.kind, [], draft.model),
    [draft.kind, draft.model]
  );
  const batchCreate = isCatalogProvider(draft.kind);

  const canSave = Boolean(draft.apiKey?.trim()) && !saving;

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!canSave) {
      return;
    }
    // 目录型供应商默认启用全部内置模型；一个 API Key 只生成一条供应商配置。
    const input: ProviderInput = {
      ...draft,
      models: batchCreate ? modelOptions.map((option) => option.id) : undefined
    };
    const validation = validateProviderDraft(input, { hasStoredKey: false });
    const firstError = Object.values(validation).find(Boolean);
    if (firstError) {
      console.warn("[setup] 首次配置校验未通过", validation);
      setError(t(firstError));
      return;
    }
    setSaving(true);
    setError("");
    try {
      await saveProvider(input);
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
            <Select
              value={draft.kind}
              onValueChange={(value) => {
                const kind = value as ProviderInput["kind"];
                setDraft({
                  ...PROVIDER_PRESETS[kind],
                  apiKey: draft.apiKey,
                  reasoningMode: undefined
                });
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_KIND_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-micro text-muted-slate">Base URL</Label>
              <Input
                value={draft.baseURL}
                onChange={(event) => setDraft({ ...draft, baseURL: event.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-micro text-muted-slate">
                {batchCreate
                  ? t("settings.providers.includedModels")
                  : t("settings.providers.model")}
              </Label>
              {batchCreate ? (
                <IncludedModels options={modelOptions} />
              ) : (
                <Input
                  value={draft.model}
                  placeholder={t("settings.providers.modelPlaceholder")}
                  onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                />
              )}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-micro text-muted-slate">
              {t("settings.providers.reasoning")}
            </Label>
            <div className="flex h-9 items-center rounded-xs border border-input bg-transparent px-3 text-caption text-muted-foreground">
              {t("settings.providers.reasoningDefault")}
            </div>
          </div>

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

function IncludedModels(props: { options: ProviderModelOption[] }) {
  return (
    <div className="max-h-[112px] overflow-y-auto rounded-xs border bg-canvas">
      {props.options.map((option) => (
        <div key={option.id} className="border-b px-3 py-2 text-caption last:border-b-0">
          {modelOptionLabel(option)}
        </div>
      ))}
    </div>
  );
}

function modelOptionLabel(option: ProviderModelOption): string {
  return option.label ?? option.id;
}
