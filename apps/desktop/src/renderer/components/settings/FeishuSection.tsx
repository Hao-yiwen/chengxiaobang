import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FeishuDomain, FeishuStatus } from "@chengxiaobang/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SectionShell, SettingBlock } from "@/components/settings/SectionShell";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

const STATUS_POLL_MS = 3000;

/** Settings section for the Feishu bot: credentials, switches, live status. */
export function FeishuSection() {
  const { t } = useTranslation();
  const feishuConfig = useAppStore((state) => state.feishuConfig);
  const feishuStatus = useAppStore((state) => state.feishuStatus);
  const loadFeishuConfig = useAppStore((state) => state.loadFeishuConfig);
  const saveFeishuConfig = useAppStore((state) => state.saveFeishuConfig);
  const refreshFeishuStatus = useAppStore((state) => state.refreshFeishuStatus);

  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [domain, setDomain] = useState<FeishuDomain>("feishu");
  const [enabled, setEnabled] = useState(false);
  const [fullAccess, setFullAccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void loadFeishuConfig();
    const timer = window.setInterval(() => void refreshFeishuStatus(), STATUS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [loadFeishuConfig, refreshFeishuStatus]);

  // Sync the form when the persisted config arrives (the secret never echoes).
  useEffect(() => {
    if (feishuConfig) {
      setAppId(feishuConfig.appId);
      setDomain(feishuConfig.domain);
      setEnabled(feishuConfig.enabled);
      setFullAccess(feishuConfig.fullAccess);
    }
  }, [feishuConfig]);

  async function save(): Promise<void> {
    setSaving(true);
    try {
      await saveFeishuConfig({ enabled, appId, appSecret, domain, fullAccess });
      setAppSecret("");
      setSaved(true);
      window.setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionShell title={t("settings.feishu.title")}>
      <SettingBlock
        title={t("settings.feishu.connTitle")}
        description={t("settings.feishu.connDesc")}
      >
        <Card className="space-y-4 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="feishu-app-id">{t("settings.feishu.appId")}</Label>
              <Input
                id="feishu-app-id"
                aria-label={t("settings.feishu.appId")}
                value={appId}
                onChange={(event) => setAppId(event.target.value)}
                placeholder="cli_xxx"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="feishu-app-secret">{t("settings.feishu.appSecret")}</Label>
              <Input
                id="feishu-app-secret"
                aria-label={t("settings.feishu.appSecret")}
                type="password"
                value={appSecret}
                onChange={(event) => setAppSecret(event.target.value)}
                placeholder={
                  feishuConfig?.appSecretRef ? t("settings.feishu.appSecretKeepHint") : ""
                }
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t("settings.feishu.domain")}</Label>
            <Select value={domain} onValueChange={(value) => setDomain(value as FeishuDomain)}>
              <SelectTrigger
                aria-label={t("settings.feishu.domain")}
                className="w-full sm:w-[260px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="feishu">{t("settings.feishu.domainFeishu")}</SelectItem>
                <SelectItem value="lark">{t("settings.feishu.domainLark")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-4 border-t pt-4">
            <div>
              <div className="text-caption font-medium">{t("settings.feishu.enable")}</div>
              <p className="text-micro text-muted-foreground">{t("settings.feishu.enableDesc")}</p>
            </div>
            <Switch
              aria-label={t("settings.feishu.enable")}
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </div>
          <div className="flex items-center justify-between gap-4 border-t pt-4">
            <div>
              <div className="text-caption font-medium">{t("settings.feishu.fullAccess")}</div>
              <p className="text-micro text-muted-foreground">
                {t("settings.feishu.fullAccessDesc")}
              </p>
            </div>
            <Switch
              aria-label={t("settings.feishu.fullAccess")}
              checked={fullAccess}
              onCheckedChange={setFullAccess}
            />
          </div>
          {fullAccess ? (
            <p className="rounded-sm border border-destructive/30 bg-destructive/5 px-3 py-2 text-micro text-destructive">
              {t("settings.feishu.fullAccessWarning")}
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-3 border-t pt-4">
            {saved ? (
              <span className="text-micro text-muted-foreground">
                {t("settings.feishu.saved")}
              </span>
            ) : null}
            <Button onClick={() => void save()} disabled={saving || appId.trim().length === 0}>
              {t("settings.feishu.save")}
            </Button>
          </div>
        </Card>
      </SettingBlock>

      <SettingBlock title={t("settings.feishu.statusTitle")}>
        <StatusRow status={feishuStatus} />
      </SettingBlock>

      <SettingBlock
        title={t("settings.feishu.guideTitle")}
        description={t("settings.feishu.guideDesc")}
      >
        <ol className="list-decimal space-y-1.5 pl-5 text-caption text-muted-foreground">
          <li>{t("settings.feishu.guide1")}</li>
          <li>{t("settings.feishu.guide2")}</li>
          <li>{t("settings.feishu.guide3")}</li>
          <li>{t("settings.feishu.guide4")}</li>
          <li>{t("settings.feishu.guide5")}</li>
        </ol>
      </SettingBlock>
    </SectionShell>
  );
}

function StatusRow({ status }: { status?: FeishuStatus }) {
  const { t } = useTranslation();
  const state = status?.status ?? "disconnected";
  return (
    <div className="flex items-center gap-2.5 text-caption">
      <span
        className={cn(
          "size-2.5 flex-none rounded-full",
          state === "connected" && "bg-coral",
          state === "connecting" && "animate-pulse bg-muted-foreground",
          state === "disconnected" && "bg-muted-foreground/40",
          state === "error" && "bg-destructive"
        )}
      />
      <span className="font-medium">{t(`settings.feishu.status.${state}`)}</span>
      {status?.botName ? (
        <span className="text-muted-foreground">{status.botName}</span>
      ) : null}
      {status?.error ? (
        <span className="min-w-0 truncate text-micro text-destructive" title={status.error}>
          {status.error}
        </span>
      ) : null}
    </div>
  );
}
