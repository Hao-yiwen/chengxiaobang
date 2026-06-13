import {
  ArrowClockwiseIcon as RefreshCw,
  CaretDownIcon as ChevronDown,
  CheckCircleIcon as CheckCircle,
  CircleNotchIcon as Loader2,
  QrCodeIcon as QrCode,
  WarningCircleIcon as WarningCircle
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import type { FeishuDomain, FeishuStatus } from "@chengxiaobang/shared";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "@/components/ui/collapsible";
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
const MIN_INSTALL_POLL_MS = 3000;

type InstallState = {
  status: "idle" | "loading" | "showing" | "success" | "error";
  url: string;
  deviceCode: string;
  userCode: string;
  timeLeft: number;
  error: string;
};

const INITIAL_INSTALL_STATE: InstallState = {
  status: "idle",
  url: "",
  deviceCode: "",
  userCode: "",
  timeLeft: 0,
  error: ""
};

/** 飞书机器人设置区：凭据、开关与实时连接状态。 */
export function FeishuSection() {
  const { t } = useTranslation();
  const feishuConfig = useAppStore((state) => state.feishuConfig);
  const feishuStatus = useAppStore((state) => state.feishuStatus);
  const loadFeishuConfig = useAppStore((state) => state.loadFeishuConfig);
  const saveFeishuConfig = useAppStore((state) => state.saveFeishuConfig);
  const startFeishuInstall = useAppStore((state) => state.startFeishuInstall);
  const pollFeishuInstall = useAppStore((state) => state.pollFeishuInstall);
  const refreshFeishuStatus = useAppStore((state) => state.refreshFeishuStatus);

  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [domain, setDomain] = useState<FeishuDomain>("feishu");
  const [enabled, setEnabled] = useState(false);
  const [fullAccess, setFullAccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [install, setInstall] = useState<InstallState>(INITIAL_INSTALL_STATE);
  const installPollTimerRef = useRef<number | undefined>(undefined);
  const installCountdownTimerRef = useRef<number | undefined>(undefined);
  const installAttemptRef = useRef(0);

  useEffect(() => {
    void loadFeishuConfig();
    const timer = window.setInterval(() => void refreshFeishuStatus(), STATUS_POLL_MS);
    return () => {
      window.clearInterval(timer);
      cancelInstallAttempt();
    };
  }, [loadFeishuConfig, refreshFeishuStatus]);

  // 持久化配置到达后同步表单；密钥不会回显。
  useEffect(() => {
    if (feishuConfig) {
      setAppId(feishuConfig.appId);
      setDomain(feishuConfig.domain);
      setEnabled(feishuConfig.enabled);
      setFullAccess(feishuConfig.fullAccess);
    }
  }, [feishuConfig]);

  function clearInstallTimers(): void {
    if (installPollTimerRef.current !== undefined) {
      window.clearInterval(installPollTimerRef.current);
      installPollTimerRef.current = undefined;
    }
    if (installCountdownTimerRef.current !== undefined) {
      window.clearInterval(installCountdownTimerRef.current);
      installCountdownTimerRef.current = undefined;
    }
  }

  function cancelInstallAttempt(): void {
    installAttemptRef.current += 1;
    clearInstallTimers();
  }

  function changeDomain(nextDomain: FeishuDomain): void {
    cancelInstallAttempt();
    setInstall(INITIAL_INSTALL_STATE);
    setDomain(nextDomain);
  }

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

  async function startInstall(): Promise<void> {
    if (saving || install.status === "loading" || install.status === "showing") {
      return;
    }
    clearInstallTimers();
    const attempt = installAttemptRef.current + 1;
    installAttemptRef.current = attempt;
    setInstall({ ...INITIAL_INSTALL_STATE, status: "loading" });

    let started;
    try {
      started = await startFeishuInstall({ domain });
    } catch (error) {
      if (attempt !== installAttemptRef.current) {
        return;
      }
      setInstall({
        ...INITIAL_INSTALL_STATE,
        status: "error",
        error: error instanceof Error ? error.message : String(error)
      });
      return;
    }

    if (attempt !== installAttemptRef.current) {
      return;
    }
    if (!started.ok) {
      setInstall({
        ...INITIAL_INSTALL_STATE,
        status: "error",
        error: started.message
      });
      return;
    }

    setInstall({
      status: "showing",
      url: started.url,
      deviceCode: started.deviceCode,
      userCode: started.userCode,
      timeLeft: started.expiresIn,
      error: ""
    });
    installCountdownTimerRef.current = window.setInterval(() => {
      setInstall((current) => {
        if (current.status !== "showing") {
          return current;
        }
        if (current.timeLeft <= 1) {
          cancelInstallAttempt();
          return {
            ...current,
            status: "error",
            timeLeft: 0,
            error: t("settings.feishu.installExpired")
          };
        }
        return { ...current, timeLeft: current.timeLeft - 1 };
      });
    }, 1000);

    const poll = async (): Promise<void> => {
      try {
        const result = await pollFeishuInstall({ deviceCode: started.deviceCode });
        if (attempt !== installAttemptRef.current) {
          return;
        }
        if (result.done) {
          clearInstallTimers();
          setAppId(result.config.appId);
          setDomain(result.config.domain);
          setEnabled(result.config.enabled);
          setFullAccess(result.config.fullAccess);
          setInstall((current) => ({ ...current, status: "success", error: "", timeLeft: 0 }));
          setSaved(true);
          window.setTimeout(() => setSaved(false), 3000);
          return;
        }
        if (result.error) {
          cancelInstallAttempt();
          setInstall((current) => ({
            ...current,
            status: "error",
            error: result.error ?? t("settings.feishu.installFailed")
          }));
        }
      } catch (error) {
        if (attempt !== installAttemptRef.current) {
          return;
        }
        cancelInstallAttempt();
        setInstall((current) => ({
          ...current,
          status: "error",
          error: error instanceof Error ? error.message : String(error)
        }));
      }
    };
    installPollTimerRef.current = window.setInterval(
      () => void poll(),
      Math.max(started.interval * 1000, MIN_INSTALL_POLL_MS)
    );
  }

  return (
    <SectionShell title={t("settings.feishu.title")}>
      <SettingBlock
        title={t("settings.feishu.scanTitle")}
        description={t("settings.feishu.scanDesc")}
      >
        <div data-testid="settings-feishu-form" className="space-y-4 rounded-sm border bg-background p-6">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_244px]">
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="space-y-1.5">
                  <Label>{t("settings.feishu.scanPlatform")}</Label>
                  <Select
                    value={domain}
                    onValueChange={(value) => changeDomain(value as FeishuDomain)}
                    disabled={install.status === "loading" || install.status === "showing"}
                  >
                    <SelectTrigger
                      aria-label={t("settings.feishu.scanPlatform")}
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
                <Button
                  onClick={() => void startInstall()}
                  disabled={saving || install.status === "loading" || install.status === "showing"}
                >
                  {install.status === "loading" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <QrCode className="size-4" />
                  )}
                  {install.status === "loading"
                    ? t("settings.feishu.installLoading")
                    : t("settings.feishu.installStart")}
                </Button>
              </div>

              <div className="rounded-sm border border-hairline bg-canvas-soft p-4">
                <InstallStatus install={install} saved={saved} />
              </div>
            </div>

            <div className="flex min-h-[244px] items-center justify-center rounded-sm border border-hairline bg-canvas p-4">
              <QrSurface install={install} onRetry={() => void startInstall()} />
            </div>
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
        </div>
      </SettingBlock>

      <SettingBlock title={t("settings.feishu.statusTitle")}>
        <StatusRow status={feishuStatus} />
      </SettingBlock>

      <SettingBlock
        title={t("settings.feishu.manualTitle")}
        description={t("settings.feishu.manualDesc")}
      >
        <Collapsible open={manualOpen} onOpenChange={setManualOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between rounded-sm">
              <span>{t("settings.feishu.manualToggle")}</span>
              <ChevronDown
                className={cn("size-4 transition-transform", manualOpen && "rotate-180")}
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-4 space-y-4 rounded-sm border bg-background p-6">
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
                <Select value={domain} onValueChange={(value) => changeDomain(value as FeishuDomain)}>
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
                  <p className="text-micro text-muted-foreground">
                    {t("settings.feishu.enableDesc")}
                  </p>
                </div>
                <Switch
                  aria-label={t("settings.feishu.enable")}
                  checked={enabled}
                  onCheckedChange={setEnabled}
                />
              </div>
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
            </div>
          </CollapsibleContent>
        </Collapsible>
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

function InstallStatus({ install, saved }: { install: InstallState; saved: boolean }) {
  const { t } = useTranslation();
  if (install.status === "success") {
    return (
      <div className="flex items-start gap-3 text-caption">
        <CheckCircle className="mt-0.5 size-4 flex-none text-success" />
        <div>
          <div className="font-medium text-ink">{t("settings.feishu.installSuccess")}</div>
          <div className="mt-1 text-micro text-muted-foreground">
            {saved ? t("settings.feishu.saved") : t("settings.feishu.installConnected")}
          </div>
        </div>
      </div>
    );
  }
  if (install.status === "error") {
    return (
      <div className="flex items-start gap-3 text-caption">
        <WarningCircle className="mt-0.5 size-4 flex-none text-destructive" />
        <div>
          <div className="font-medium text-destructive">{t("settings.feishu.installFailed")}</div>
          <div className="mt-1 text-micro text-muted-foreground">
            {install.error || t("settings.feishu.installFailed")}
          </div>
        </div>
      </div>
    );
  }
  if (install.status === "showing") {
    return (
      <div className="flex items-start gap-3 text-caption">
        <Loader2 className="mt-0.5 size-4 flex-none animate-spin text-muted-foreground" />
        <div>
          <div className="font-medium text-ink">{t("settings.feishu.installWaiting")}</div>
          <div className="mt-1 text-micro text-muted-foreground">
            {t("settings.feishu.installTimeLeft", { seconds: install.timeLeft })}
          </div>
          {formatUserCode(install.userCode, install.deviceCode) ? (
            <div className="mt-2 font-mono text-micro text-ink">
              {t("settings.feishu.installUserCode", {
                code: formatUserCode(install.userCode, install.deviceCode)
              })}
            </div>
          ) : null}
        </div>
      </div>
    );
  }
  if (install.status === "loading") {
    return (
      <div className="flex items-start gap-3 text-caption">
        <Loader2 className="mt-0.5 size-4 flex-none animate-spin text-muted-foreground" />
        <div>
          <div className="font-medium text-ink">{t("settings.feishu.installLoading")}</div>
          <div className="mt-1 text-micro text-muted-foreground">
            {t("settings.feishu.installLoadingDesc")}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3 text-caption">
      <QrCode className="mt-0.5 size-4 flex-none text-muted-foreground" />
      <div>
        <div className="font-medium text-ink">{t("settings.feishu.installIdle")}</div>
        <div className="mt-1 text-micro text-muted-foreground">
          {t("settings.feishu.installIdleDesc")}
        </div>
      </div>
    </div>
  );
}

function QrSurface({ install, onRetry }: { install: InstallState; onRetry: () => void }) {
  const { t } = useTranslation();
  if (install.status === "loading") {
    return (
      <div className="grid justify-items-center gap-2 text-center text-micro text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
        <span>{t("settings.feishu.installLoading")}</span>
      </div>
    );
  }
  if (install.status === "error") {
    return (
      <div className="grid justify-items-center gap-3 text-center">
        <WarningCircle className="size-8 text-destructive" />
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="size-3.5" />
          {t("settings.feishu.installRetry")}
        </Button>
      </div>
    );
  }
  if (install.status === "success") {
    return (
      <div className="grid justify-items-center gap-3 text-center">
        <CheckCircle className="size-9 text-success" />
        <span className="text-micro text-muted-foreground">
          {t("settings.feishu.installConnected")}
        </span>
      </div>
    );
  }
  if (install.url) {
    return <QRCodeSVG value={install.url} size={196} marginSize={2} />;
  }
  return (
    <div className="grid justify-items-center gap-3 text-center text-muted-foreground">
      <div className="flex size-20 items-center justify-center rounded-sm border bg-canvas-soft">
        <QrCode className="size-9" />
      </div>
      <span className="text-micro">{t("settings.feishu.installQrPlaceholder")}</span>
    </div>
  );
}

function formatUserCode(userCode: string, deviceCode: string): string {
  const source = userCode.trim() || deviceCode.trim();
  const compact = source.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 8);
  if (compact.length <= 4) {
    return compact;
  }
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

function StatusRow({ status }: { status?: FeishuStatus }) {
  const { t } = useTranslation();
  const state = status?.status ?? "disconnected";
  return (
    <div className="flex items-center gap-2.5 text-caption">
      <span
        className={cn(
          "size-2.5 flex-none rounded-full",
          state === "connected" && "bg-success",
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
