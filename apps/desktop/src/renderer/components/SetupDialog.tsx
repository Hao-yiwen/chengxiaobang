import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProviderInput } from "@chengxiaobang/shared";
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
import { useAppStore } from "@/store";

/**
 * Compact first-run dialog: pick a provider, paste an API key, start chatting.
 * Shown over the home screen instead of forcing users into the settings page;
 * everything here can be revisited later under 设置 → 供应商.
 */
export function SetupDialog() {
  const { t } = useTranslation();
  const open = useAppStore((state) => state.onboardingOpen);
  const setSetupOpen = useAppStore((state) => state.setOnboardingOpen);
  const saveProvider = useAppStore((state) => state.saveProvider);

  const [draft, setDraft] = useState<ProviderInput>({ ...PROVIDER_PRESETS.deepseek, apiKey: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const canSave = Boolean(draft.apiKey?.trim()) && !saving;

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!canSave) {
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
      <DialogContent className="max-w-[420px] gap-5 rounded-2xl p-6">
        <DialogHeader className="items-center text-center sm:text-center">
          <Logo className="mb-2 size-10" />
          <DialogTitle className="text-[17px]">{t("setup.title")}</DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed">
            {t("setup.desc")}
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-3.5" onSubmit={onSubmit}>
          <div className="grid gap-1.5">
            <Label className="text-[12.5px] text-muted-foreground">
              {t("settings.providers.type")}
            </Label>
            <Select
              value={draft.kind}
              onValueChange={(value) => {
                const kind = value as ProviderInput["kind"];
                setDraft({ ...PROVIDER_PRESETS[kind], apiKey: draft.apiKey });
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
              <Label className="text-[12.5px] text-muted-foreground">API Key</Label>
              {API_KEY_URLS[draft.kind] ? (
                <a
                  href={API_KEY_URLS[draft.kind]}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-[12px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
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
              <Label className="text-[12.5px] text-muted-foreground">Base URL</Label>
              <Input
                value={draft.baseURL}
                onChange={(event) => setDraft({ ...draft, baseURL: event.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-[12.5px] text-muted-foreground">
                {t("settings.providers.model")}
              </Label>
              <Input
                value={draft.model}
                onChange={(event) => setDraft({ ...draft, model: event.target.value })}
              />
            </div>
          </div>

          {error ? <p className="text-[12.5px] text-destructive">{error}</p> : null}

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
            <Button type="submit" size="sm" className="rounded-full px-4" disabled={!canSave}>
              {saving ? t("setup.saving") : t("setup.save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
