import {
  FolderOpenOutlineIcon,
  PlusIcon,
  PuzzlePieceOutlineIcon,
  TrashIcon
} from "@/assets/file-type-icons";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type {
  PluginConfigField,
  PluginConfigValues,
  PluginDetail,
  PluginSummary
} from "@chengxiaobang/shared";
import { useShallow } from "zustand/react/shallow";
import { useConfirmDialog } from "@/components/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SectionShell, SettingBlock } from "@/components/settings/SectionShell";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

const softBluePillClassName =
  "border-soft-blue-border bg-soft-blue-surface text-soft-blue-foreground";
const softBlueButtonClassName =
  "border border-soft-blue-border bg-soft-blue-surface text-soft-blue-foreground hover:border-soft-blue hover:bg-soft-blue-surface-hover hover:text-soft-blue-strong [&_svg]:text-soft-blue-foreground hover:[&_svg]:text-soft-blue-strong";

/** 插件贡献计数的一行简短摘要（仅在 hooks 非零时附带钩子计数）。 */
function ContributionsLine(props: { plugin: Pick<PluginSummary, "contributions"> }) {
  const { t } = useTranslation();
  const { skills, commands, mcpServers, hooks } = props.plugin.contributions;
  const base = { skills, commands, mcp: mcpServers };
  const label =
    hooks > 0
      ? t("settings.plugins.contributionsHooks", { ...base, hooks })
      : t("settings.plugins.contributions", base);
  return <div className="mt-3 font-mono text-micro text-mute">{label}</div>;
}

/** 插件设置页 = 导入入口 + 已安装插件区 + 内置插件区 + 目录管理。 */
export function PluginsSection() {
  const { t } = useTranslation();
  const plugins = useAppStore(useShallow((state) => state.plugins));
  const loadPlugins = useAppStore((state) => state.loadPlugins);
  const setNotice = useAppStore((state) => state.setNotice);

  const [importOpen, setImportOpen] = useState(false);
  // 当前查看详情的插件名（null = 详情弹窗关闭）。
  const [detailName, setDetailName] = useState<string | null>(null);

  useEffect(() => {
    console.debug("[plugins-section] 进入插件设置页，加载插件列表");
    void loadPlugins();
  }, [loadPlugins]);

  const installedPlugins = useMemo(
    () => plugins.filter((plugin) => plugin.source === "installed"),
    [plugins]
  );
  const builtinPlugins = useMemo(
    () => plugins.filter((plugin) => plugin.source === "builtin"),
    [plugins]
  );

  return (
    <SectionShell title={t("settings.plugins.title")}>
      <SettingBlock
        title={t("settings.plugins.importTitle")}
        description={t("settings.plugins.importDesc")}
      >
        <Button
          type="button"
          variant="outline"
          className={cn("w-fit", softBlueButtonClassName)}
          onClick={() => setImportOpen(true)}
        >
          <PlusIcon className="size-4" />
          {t("settings.plugins.import")}
        </Button>
      </SettingBlock>

      <SettingBlock title={t("settings.plugins.installedTitle")}>
        {installedPlugins.length === 0 ? (
          <p className="text-caption text-muted-foreground">
            {t("settings.plugins.installedEmpty")}
          </p>
        ) : (
          <div
            data-testid="settings-plugins-installed"
            className="grid grid-cols-1 gap-3 lg:grid-cols-2"
          >
            {installedPlugins.map((plugin) => (
              <PluginCard
                key={`installed:${plugin.name}`}
                plugin={plugin}
                onOpen={() => setDetailName(plugin.name)}
              />
            ))}
          </div>
        )}
      </SettingBlock>

      <SettingBlock title={t("settings.plugins.builtinTitle")}>
        {builtinPlugins.length === 0 ? (
          <p className="text-caption text-muted-foreground">
            {t("settings.plugins.builtinEmpty")}
          </p>
        ) : (
          <div
            data-testid="settings-plugins-builtin"
            className="grid grid-cols-1 gap-3 lg:grid-cols-2"
          >
            {builtinPlugins.map((plugin) => (
              <PluginCard
                key={`builtin:${plugin.name}`}
                plugin={plugin}
                onOpen={() => setDetailName(plugin.name)}
              />
            ))}
          </div>
        )}
      </SettingBlock>

      <SettingBlock
        title={t("settings.plugins.manageTitle")}
        description={t("settings.plugins.manageDesc")}
      >
        <Button
          type="button"
          variant="outline"
          className="w-fit"
          onClick={async () => {
            if (!window.chengxiaobang?.openPluginsDir) {
              setNotice(t("settings.plugins.desktopOnly"));
              return;
            }
            const result = await window.chengxiaobang.openPluginsDir();
            if (!result.ok) {
              console.warn("[plugins-section] 打开插件目录失败", result);
              setNotice(result.error ?? t("settings.plugins.desktopOnly"));
            }
          }}
        >
          <FolderOpenOutlineIcon className="size-4" />
          {t("settings.plugins.openDir")}
        </Button>
      </SettingBlock>

      <ImportPluginDialog open={importOpen} onOpenChange={setImportOpen} />
      <PluginDetailDialog name={detailName} onClose={() => setDetailName(null)} />
    </SectionShell>
  );
}

function PluginSourceBadge(props: { source: PluginSummary["source"] }) {
  const { t } = useTranslation();
  const badgeClassName =
    props.source === "builtin"
      ? "border-emerald-500/20 bg-emerald-50 text-emerald-700"
      : softBluePillClassName;
  return (
    <Badge
      variant="outline"
      className={cn("h-4 flex-none px-1.5 py-0 text-[11px] leading-4", badgeClassName)}
    >
      {t(`settings.plugins.source.${props.source}`)}
    </Badge>
  );
}

/**
 * 单张插件卡：整卡可点击查看详情；右侧启停 Switch 阻止冒泡。
 * 启停失败的反馈走全局 notice（与技能卡一致）。
 */
export function PluginCard(props: { plugin: PluginSummary; onOpen(): void }) {
  const { t } = useTranslation();
  const { plugin, onOpen } = props;
  const setPluginEnabled = useAppStore((state) => state.setPluginEnabled);
  const setNotice = useAppStore((state) => state.setNotice);
  const [busy, setBusy] = useState(false);

  async function toggle(enabled: boolean): Promise<void> {
    if (busy) {
      return;
    }
    setBusy(true);
    console.info("[plugins-section] 切换插件启停", { name: plugin.name, enabled });
    try {
      await setPluginEnabled(plugin.name, enabled);
    } catch (error) {
      console.error("[plugins-section] 切换插件启停失败", { name: plugin.name, enabled, error });
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      asChild
      className="flex cursor-pointer flex-col px-4 py-3 transition-colors hover:border-soft-blue-border hover:bg-soft-blue-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <article
        data-testid={`plugin-card-${plugin.source}-${plugin.name}`}
        role="button"
        tabIndex={0}
        aria-label={t("settings.plugins.viewDetail", { name: plugin.name })}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen();
          }
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-body-sm font-medium text-foreground">
              {plugin.name}
            </span>
            {plugin.version ? (
              <span className="flex-none font-mono text-micro text-mute">v{plugin.version}</span>
            ) : null}
            <PluginSourceBadge source={plugin.source} />
          </div>
          <span
            // Switch 自身可交互，点击不应触发卡片详情。
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <Switch
              checked={plugin.enabled}
              disabled={busy}
              aria-label={t(plugin.enabled ? "skills.disablePlugin" : "skills.enablePlugin")}
              onCheckedChange={(checked) => void toggle(checked)}
            />
          </span>
        </div>
        <p className="mt-1.5 line-clamp-2 min-h-[2rem] flex-1 text-caption leading-relaxed [color:rgb(var(--body))]">
          {plugin.description}
        </p>
        <ContributionsLine plugin={plugin} />
      </article>
    </Card>
  );
}

function DetailGroup(props: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-2 font-mono text-caption tracking-[0.28px] text-foreground">
        <span className="h-3 w-px rounded-full bg-foreground" aria-hidden />
        {props.title}
      </h3>
      {props.children}
    </div>
  );
}

/**
 * 插件详情弹窗：按名拉取详情；头部 name/version/author；分区列出技能/命令/MCP server；
 * configFields 非空时渲染配置表单；底部安装路径 + 卸载按钮（仅 installed 来源）。
 */
export function PluginDetailDialog(props: { name: string | null; onClose(): void }) {
  const { t } = useTranslation();
  const { name, onClose } = props;
  const confirmDialog = useConfirmDialog();
  const getPluginDetail = useAppStore((state) => state.getPluginDetail);
  const setPluginConfig = useAppStore((state) => state.setPluginConfig);
  const uninstallPlugin = useAppStore((state) => state.uninstallPlugin);
  const setNotice = useAppStore((state) => state.setNotice);
  // 头部仍读实时概要：在弹窗外启停后能即时反映启用态。
  const summary = useAppStore((state) =>
    name ? state.plugins.find((plugin) => plugin.name === name) : undefined
  );

  const [detail, setDetail] = useState<PluginDetail | undefined>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!name) {
      setDetail(undefined);
      return;
    }
    let active = true;
    setLoading(true);
    setDetail(undefined);
    void getPluginDetail(name)
      .then((result) => {
        if (active) {
          setDetail(result);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [name, getPluginDetail]);

  // 卸载后 store 概要消失，自动关闭弹窗。
  useEffect(() => {
    if (name && !summary && !loading) {
      onClose();
    }
  }, [name, summary, loading, onClose]);

  const heading = summary ?? detail;
  // 概要里的 author 已被后端归一化为展示名字符串。
  const author = heading?.author;

  async function confirmUninstall(): Promise<void> {
    if (!detail) {
      return;
    }
    console.debug("[plugins-section] 请求卸载插件", { name: detail.name });
    const confirmed = await confirmDialog({
      title: t("settings.plugins.uninstallTitle", { name: detail.name }),
      description: t("settings.plugins.uninstallConfirm"),
      confirmLabel: t("settings.plugins.uninstall"),
      cancelLabel: t("confirmDialog.cancel"),
      tone: "danger",
      source: "settings.uninstallPlugin"
    });
    if (!confirmed) {
      console.debug("[plugins-section] 用户取消卸载插件", { name: detail.name });
      return;
    }
    console.info("[plugins-section] 用户确认卸载插件", { name: detail.name });
    try {
      await uninstallPlugin(detail.name);
    } catch (error) {
      console.error("[plugins-section] 卸载插件失败", { name: detail.name, error });
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <Dialog open={name != null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="flex max-h-[80vh] max-w-[680px] flex-col gap-0 p-0">
        <DialogHeader className="items-start gap-2 border-b px-7 pb-4 pt-7 text-left sm:text-left">
          <div className="flex w-full flex-wrap items-center gap-2">
            <DialogTitle className="text-body-sm">{name}</DialogTitle>
            {detail?.version ? (
              <span className="font-mono text-micro text-mute">v{detail.version}</span>
            ) : null}
            {heading ? <PluginSourceBadge source={heading.source} /> : null}
            {author ? <span className="text-micro text-mute">· {author}</span> : null}
          </div>
          <DialogDescription className="text-caption [color:rgb(var(--body))]">
            {heading?.description}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-7 py-5">
          {loading ? (
            <p className="text-body-sm text-mute">{t("skills.detailLoading")}</p>
          ) : detail ? (
            <>
              <DetailGroup title={t("settings.plugins.sectionSkills")}>
                {detail.skills.length === 0 ? (
                  <p className="text-caption text-mute">{t("settings.plugins.sectionNoneSkills")}</p>
                ) : (
                  <ul className="space-y-1.5">
                    {detail.skills.map((skill) => (
                      <li key={skill.name} className="flex flex-col">
                        <span className="font-mono text-body-xs text-foreground">{skill.name}</span>
                        <span className="text-caption [color:rgb(var(--body))]">
                          {skill.description}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </DetailGroup>

              <DetailGroup title={t("settings.plugins.sectionCommands")}>
                {detail.commands.length === 0 ? (
                  <p className="text-caption text-mute">
                    {t("settings.plugins.sectionNoneCommands")}
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {detail.commands.map((command) => (
                      <li key={command.name} className="flex flex-col">
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-body-xs text-foreground">
                            {command.name}
                          </span>
                          {command.argumentHint ? (
                            <span className="font-mono text-micro text-mute">
                              {command.argumentHint}
                            </span>
                          ) : null}
                        </span>
                        <span className="text-caption [color:rgb(var(--body))]">
                          {command.description}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </DetailGroup>

              <DetailGroup title={t("settings.plugins.sectionMcp")}>
                {detail.mcpServers.length === 0 ? (
                  <p className="text-caption text-mute">{t("settings.plugins.sectionNoneMcp")}</p>
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {detail.mcpServers.map((server) => (
                      <li
                        key={server.name}
                        className={cn(
                          "rounded-full border px-2 py-0.5 font-mono text-micro",
                          softBluePillClassName
                        )}
                      >
                        {server.name}
                      </li>
                    ))}
                  </ul>
                )}
              </DetailGroup>

              {detail.configFields.length > 0 ? (
                <DetailGroup title={t("settings.plugins.sectionConfig")}>
                  <PluginConfigForm
                    pluginName={detail.name}
                    fields={detail.configFields}
                    values={detail.configValues}
                    onSaved={(next) => setDetail(next)}
                    save={setPluginConfig}
                  />
                </DetailGroup>
              ) : null}
            </>
          ) : (
            <p className="text-body-sm text-mute">{t("skills.detailUnavailable")}</p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t px-7 py-4">
          <span className="truncate font-mono text-micro text-mute" title={detail?.installPath}>
            {detail?.installPath ?? ""}
          </span>
          <div className="flex flex-none items-center gap-2">
            {detail?.source === "installed" ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-error-deep"
                onClick={() => void confirmUninstall()}
              >
                <TrashIcon className="size-3.5" />
                {t("settings.plugins.uninstall")}
              </Button>
            ) : null}
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>
              {t("settings.plugins.close")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 插件 userConfig 配置表单：按 field.type 渲染输入控件，保存后回填最新详情。 */
function PluginConfigForm(props: {
  pluginName: string;
  fields: PluginConfigField[];
  values: PluginConfigValues;
  onSaved(detail: PluginDetail): void;
  save(name: string, values: PluginConfigValues): Promise<PluginDetail | undefined>;
}) {
  const { t } = useTranslation();
  const setNotice = useAppStore((state) => state.setNotice);
  const [draft, setDraft] = useState<PluginConfigValues>(() =>
    initialConfigDraft(props.fields, props.values)
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  // 切换插件后用新字段/取值重置草稿。
  useEffect(() => {
    setDraft(initialConfigDraft(props.fields, props.values));
    setStatus("");
  }, [props.pluginName, props.fields, props.values]);

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) {
      return;
    }
    setBusy(true);
    setStatus("");
    console.info("[plugins-section] 保存插件配置", {
      name: props.pluginName,
      keys: Object.keys(draft)
    });
    try {
      const detail = await props.save(props.pluginName, draft);
      if (detail) {
        props.onSaved(detail);
      }
      setStatus(t("settings.plugins.saved"));
    } catch (error) {
      console.error("[plugins-section] 保存插件配置失败", { name: props.pluginName, error });
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="space-y-4">
      {props.fields.map((field) => (
        <div key={field.key} className="grid gap-2">
          {field.type === "boolean" ? (
            <div className="flex items-center justify-between gap-3">
              <Label className="text-muted-foreground">{field.key}</Label>
              <Switch
                checked={Boolean(draft[field.key])}
                aria-label={field.key}
                onCheckedChange={(checked) =>
                  setDraft((prev) => ({ ...prev, [field.key]: checked }))
                }
              />
            </div>
          ) : (
            <>
              <Label className="text-muted-foreground">{field.key}</Label>
              <Input
                type={field.type === "number" ? "number" : "text"}
                aria-label={field.key}
                value={String(draft[field.key] ?? "")}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    [field.key]:
                      field.type === "number"
                        ? event.target.value === ""
                          ? ""
                          : Number(event.target.value)
                        : event.target.value
                  }))
                }
              />
            </>
          )}
          {field.description ? (
            <p className="text-micro text-mute">{field.description}</p>
          ) : null}
        </div>
      ))}
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? t("settings.plugins.saving") : t("settings.plugins.save")}
        </Button>
        {status ? <span className="text-caption text-muted-foreground">{status}</span> : null}
      </div>
    </form>
  );
}

function initialConfigDraft(
  fields: PluginConfigField[],
  values: PluginConfigValues
): PluginConfigValues {
  const draft: PluginConfigValues = {};
  for (const field of fields) {
    const current = values[field.key];
    if (current !== undefined) {
      draft[field.key] = current;
    } else if (field.default !== undefined) {
      draft[field.key] = field.default;
    } else {
      draft[field.key] = field.type === "boolean" ? false : "";
    }
  }
  return draft;
}

/**
 * 导入插件入口：① 选择本地文件夹/压缩包（取绝对路径后 installPlugin({path})）；
 * ② 粘贴 GitHub 链接（installPlugin({url})）。
 */
export function ImportPluginDialog(props: { open: boolean; onOpenChange(open: boolean): void }) {
  const { t } = useTranslation();
  const installPlugin = useAppStore((state) => state.installPlugin);

  const [localPath, setLocalPath] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function reset(): void {
    setLocalPath("");
    setUrl("");
    setError("");
  }

  async function pick(kind: "folder" | "file"): Promise<void> {
    setError("");
    if (kind === "folder") {
      const path = await window.chengxiaobang?.pickDirectory?.();
      if (path) {
        setLocalPath(path);
      }
      return;
    }
    const paths = (await window.chengxiaobang?.pickFiles?.()) ?? [];
    if (paths[0]) {
      setLocalPath(paths[0]);
    }
  }

  async function install(input: { path?: string; url?: string }): Promise<void> {
    if (busy) {
      return;
    }
    setBusy(true);
    setError("");
    console.info("[plugins-section] 提交安装插件", input);
    try {
      await installPlugin(input);
      reset();
      props.onOpenChange(false);
    } catch (cause) {
      console.error("[plugins-section] 安装插件失败", { ...input, error: cause });
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) {
          reset();
        }
        props.onOpenChange(open);
      }}
    >
      <DialogContent className="max-w-[560px] gap-5 p-7">
        <DialogHeader className="items-start border-b pb-5 text-left sm:text-left">
          <DialogTitle>{t("settings.plugins.dialogTitle")}</DialogTitle>
          <DialogDescription>{t("settings.plugins.dialogHint")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label>{t("settings.plugins.localLabel")}</Label>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void pick("folder")}>
              {t("settings.plugins.pickFolder")}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void pick("file")}>
              {t("settings.plugins.pickFile")}
            </Button>
            <span className="min-w-0 flex-1 truncate font-mono text-micro text-mute">
              {localPath || t("settings.plugins.localPlaceholder")}
            </span>
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              disabled={!localPath || busy}
              onClick={() => void install({ path: localPath })}
            >
              <PuzzlePieceOutlineIcon className="size-3.5" />
              {busy ? t("settings.plugins.importing") : t("settings.plugins.import")}
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-hairline" />
          <span className="text-micro text-mute">{t("settings.plugins.or")}</span>
          <span className="h-px flex-1 bg-hairline" />
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (url.trim()) {
              void install({ url: url.trim() });
            }
          }}
          className="space-y-2"
        >
          <Label htmlFor="plugin-url">{t("settings.plugins.urlLabel")}</Label>
          <div className="flex items-center gap-2">
            <Input
              id="plugin-url"
              value={url}
              placeholder={t("settings.plugins.urlPlaceholder")}
              onChange={(event) => setUrl(event.target.value)}
              className="flex-1"
            />
            <Button type="submit" disabled={!url.trim() || busy} className="flex-none">
              {busy ? t("settings.plugins.importing") : t("settings.plugins.import")}
            </Button>
          </div>
          <p className="text-caption text-mute">{t("settings.plugins.urlHint")}</p>
          {error ? <p className="text-caption text-error-deep">{error}</p> : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}
