import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SectionShell, SettingBlock } from "@/components/settings/SectionShell";
import { useAppStore } from "@/store";

/** Tavily 网络搜索设置区：只配置纯搜索 API，不绑定模型供应商。 */
export function WebSearchSection() {
  const { t } = useTranslation();
  const webSearchConfig = useAppStore((state) => state.webSearchConfig);
  const loadWebSearchConfig = useAppStore((state) => state.loadWebSearchConfig);
  const saveWebSearchConfig = useAppStore((state) => state.saveWebSearchConfig);
  const testWebSearchConfig = useAppStore((state) => state.testWebSearchConfig);

  const [enabled, setEnabled] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    void loadWebSearchConfig();
  }, [loadWebSearchConfig]);

  useEffect(() => {
    if (webSearchConfig) {
      setEnabled(webSearchConfig.enabled);
    }
  }, [webSearchConfig]);

  const hasStoredKey = Boolean(webSearchConfig?.apiKeyRef);
  const missingKey = enabled && apiKey.trim().length === 0 && !hasStoredKey;

  async function save(): Promise<void> {
    setSaving(true);
    setError(undefined);
    setStatus(undefined);
    try {
      await saveWebSearchConfig({ enabled, apiKey });
      setApiKey("");
      setStatus(t("settings.webSearch.saved"));
      window.setTimeout(() => setStatus(undefined), 3000);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error("[settings] 保存网络搜索配置失败", { error: message });
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  async function test(): Promise<void> {
    setTesting(true);
    setError(undefined);
    setStatus(undefined);
    try {
      await testWebSearchConfig();
      setStatus(t("settings.webSearch.testOk"));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error("[settings] 测试网络搜索失败", { error: message });
      setError(message);
    } finally {
      setTesting(false);
    }
  }

  return (
    <SectionShell title={t("settings.webSearch.title")}>
      <SettingBlock
        title={t("settings.webSearch.connTitle")}
        description={t("settings.webSearch.connDesc")}
      >
        <div data-testid="settings-web-search-form" className="space-y-4 rounded-sm border bg-background p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-caption font-medium">{t("settings.webSearch.enable")}</div>
              <p className="text-micro text-muted-foreground">
                {t("settings.webSearch.enableDesc")}
              </p>
            </div>
            <Switch
              aria-label={t("settings.webSearch.enable")}
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </div>

          <div className="rounded-sm border bg-canvas-soft px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-caption font-medium">Tavily</div>
                <p className="text-micro text-muted-foreground">
                  {t("settings.webSearch.tavilyDesc")}
                </p>
              </div>
              <span className="rounded-pill border bg-background px-2.5 py-1 text-micro text-muted-foreground">
                {t("settings.webSearch.pureSearch")}
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="web-search-api-key">{t("settings.webSearch.apiKey")}</Label>
            <Input
              id="web-search-api-key"
              aria-label={t("settings.webSearch.apiKey")}
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={hasStoredKey ? t("settings.webSearch.apiKeyKeepHint") : "tvly-..."}
            />
            <p className="text-micro text-muted-foreground">
              {t("settings.webSearch.pricingHint")}{" "}
              <a
                className="text-link hover:underline"
                href="https://app.tavily.com/home"
                rel="noreferrer"
                target="_blank"
              >
                {t("settings.webSearch.getApiKey")}
              </a>
            </p>
          </div>

          {missingKey ? (
            <p className="rounded-sm border border-destructive/30 bg-destructive/5 px-3 py-2 text-micro text-destructive">
              {t("settings.webSearch.missingKey")}
            </p>
          ) : null}
          {error ? (
            <p className="rounded-sm border border-destructive/30 bg-destructive/5 px-3 py-2 text-micro text-destructive">
              {error}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-3 border-t pt-4">
            {status ? <span className="text-micro text-muted-foreground">{status}</span> : null}
            <Button
              type="button"
              variant="outline"
              onClick={() => void test()}
              disabled={testing || !webSearchConfig?.enabled || !webSearchConfig.apiKeyRef}
            >
              {testing ? t("settings.webSearch.testing") : t("settings.webSearch.test")}
            </Button>
            <Button type="button" onClick={() => void save()} disabled={saving || missingKey}>
              {saving ? t("settings.webSearch.saving") : t("settings.webSearch.save")}
            </Button>
          </div>
        </div>
      </SettingBlock>
    </SectionShell>
  );
}
