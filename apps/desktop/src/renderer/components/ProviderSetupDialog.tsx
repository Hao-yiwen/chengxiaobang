import { ExternalLink, Sparkles } from "lucide-react";
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
import { useAppStore } from "@/store";

type PresetKind = "deepseek" | "kimi" | "openai-compatible";

interface Preset {
  name: string;
  baseURL: string;
  model: string;
  apiKeyUrl?: string;
}

const PRESETS: Record<PresetKind, Preset> = {
  deepseek: {
    name: "DeepSeek",
    baseURL: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    apiKeyUrl: "https://platform.deepseek.com/api_keys"
  },
  kimi: {
    name: "Kimi",
    baseURL: "https://api.moonshot.ai/v1",
    model: "kimi-k2.6",
    apiKeyUrl: "https://platform.kimi.ai/console/api-keys"
  },
  "openai-compatible": {
    name: "OpenAI-compatible",
    baseURL: "https://api.openai.com/v1",
    model: "gpt-4.1",
    apiKeyUrl: "https://platform.openai.com/api-keys"
  }
};

/**
 * Lightweight first-run model setup. Shown on the home screen when no model has
 * an API key yet, so users can get started without diving into full settings.
 */
export function ProviderSetupDialog() {
  const { t } = useTranslation();
  const open = useAppStore((state) => state.onboardingOpen);
  const setOnboardingOpen = useAppStore((state) => state.setOnboardingOpen);
  const saveProvider = useAppStore((state) => state.saveProvider);
  const setView = useAppStore((state) => state.setView);

  const [kind, setKind] = useState<PresetKind>("deepseek");
  const [model, setModel] = useState(PRESETS.deepseek.model);
  const [apiKey, setApiKey] = useState("");
  const [baseURL, setBaseURL] = useState(PRESETS.deepseek.baseURL);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function applyKind(next: PresetKind): void {
    setKind(next);
    setModel(PRESETS[next].model);
    setBaseURL(PRESETS[next].baseURL);
    setError("");
  }

  async function save(): Promise<void> {
    if (!apiKey.trim()) {
      return;
    }
    setSaving(true);
    setError("");
    const input: ProviderInput = {
      kind,
      name: PRESETS[kind].name,
      baseURL,
      model,
      apiKey: apiKey.trim()
    };
    try {
      await saveProvider(input);
      setApiKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const apiKeyUrl = PRESETS[kind].apiKeyUrl;

  return (
    <Dialog open={open} onOpenChange={setOnboardingOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-brand-soft">
              <Sparkles className="size-4 text-brand" />
            </span>
            {t("onboarding.title")}
          </DialogTitle>
          <DialogDescription>{t("onboarding.desc")}</DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t("onboarding.type")}</Label>
            <Select value={kind} onValueChange={(value) => applyKind(value as PresetKind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="deepseek">DeepSeek</SelectItem>
                <SelectItem value="kimi">Kimi</SelectItem>
                <SelectItem value="openai-compatible">OpenAI-compatible</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {kind === "openai-compatible" ? (
            <div className="grid gap-2">
              <Label className="text-muted-foreground">Base URL</Label>
              <Input value={baseURL} onChange={(event) => setBaseURL(event.target.value)} />
            </div>
          ) : null}

          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t("onboarding.model")}</Label>
            <Input value={model} onChange={(event) => setModel(event.target.value)} />
          </div>

          <div className="grid gap-2">
            <Label className="text-muted-foreground">API Key</Label>
            <div className="flex gap-2">
              <Input
                type="password"
                autoFocus
                placeholder="sk-..."
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
              {apiKeyUrl ? (
                <Button type="button" variant="outline" asChild>
                  <a href={apiKeyUrl} target="_blank" rel="noreferrer" title={t("onboarding.getApiKey")}>
                    <ExternalLink className="size-4" />
                  </a>
                </Button>
              ) : null}
            </div>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="mt-1 flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => {
                setOnboardingOpen(false);
                setView("settings");
              }}
            >
              {t("onboarding.toSettings")}
            </Button>
            <Button type="submit" disabled={saving || !apiKey.trim()}>
              {saving ? t("onboarding.saving") : t("onboarding.save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
