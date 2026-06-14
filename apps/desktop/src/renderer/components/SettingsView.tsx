import {
  ArrowLeftIcon as ArrowLeft,
  ArrowSquareOutIcon as ExternalLink,
  ChartBarIcon as ChartBar,
  CircleHalfTiltIcon as SunMoon,
  FolderOpenIcon as FolderOpen,
  GlobeIcon as Globe,
  LaptopIcon as Laptop,
  MagnifyingGlassIcon as Search,
  MoonIcon as Moon,
  SlidersHorizontalIcon as SlidersHorizontal,
  SparkleIcon as Sparkles,
  StackIcon as Boxes,
  SunIcon as Sun,
  TranslateIcon as Languages,
  TrashIcon as Trash2,
  type Icon
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  type ProviderConfig,
  type ProviderInput,
  type ProviderKind
} from "@chengxiaobang/shared";
import { useShallow } from "zustand/react/shallow";
import { useConfirmDialog } from "@/components/ConfirmDialog";
import { ExternalUrlAnchor } from "@/components/ExternalUrlMenu";
import {
  defaultModelIds,
  normalizeModelIds,
  ProviderCascadeSelect,
  ProviderModelTags
} from "@/components/ProviderCascadeSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OptionCard } from "@/components/settings/OptionCard";
import { SectionShell, SettingBlock } from "@/components/settings/SectionShell";
import { UsageStatsSection } from "@/components/settings/UsageStatsSection";
import { WebSearchSection } from "@/components/settings/WebSearchSection";
import { API_KEY_URLS, PROVIDER_KIND_OPTIONS, PROVIDER_PRESETS } from "@/lib/provider-presets";
import {
  validateProviderDraft,
  type ProviderDraftErrors
} from "@/lib/provider-validation";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

type SectionId =
  | "appearance"
  | "general"
  | "providers"
  | "usage"
  | "skills"
  | "webSearch";

interface NavDef {
  id: SectionId;
  labelKey:
    | "settings.nav.appearance"
    | "settings.nav.general"
    | "settings.nav.providers"
    | "settings.nav.usage"
    | "settings.nav.skills"
    | "settings.nav.webSearch";
  icon: Icon;
  groupKey: "settings.groupPersonal" | "settings.groupModel" | "settings.groupIntegrations";
}

interface NavItem {
  id: SectionId;
  label: string;
  icon: Icon;
  group: string;
}

const NAV_DEFS: NavDef[] = [
  { id: "appearance", labelKey: "settings.nav.appearance", icon: SunMoon, groupKey: "settings.groupPersonal" },
  { id: "general", labelKey: "settings.nav.general", icon: SlidersHorizontal, groupKey: "settings.groupPersonal" },
  { id: "providers", labelKey: "settings.nav.providers", icon: Boxes, groupKey: "settings.groupModel" },
  { id: "usage", labelKey: "settings.nav.usage", icon: ChartBar, groupKey: "settings.groupModel" },
  { id: "skills", labelKey: "settings.nav.skills", icon: Sparkles, groupKey: "settings.groupModel" },
  { id: "webSearch", labelKey: "settings.nav.webSearch", icon: Globe, groupKey: "settings.groupIntegrations" }
];

export function SettingsView() {
  const { t } = useTranslation();
  const { activeSessionId } = useAppStore(
    useShallow((state) => ({ activeSessionId: state.activeSessionId }))
  );
  const hasConfiguredProvider = useAppStore((state) =>
    state.providers.some((provider) => provider.apiKeyRef)
  );
  const setView = useAppStore((state) => state.setView);

  const [section, setSection] = useState<SectionId>(
    hasConfiguredProvider ? "appearance" : "providers"
  );
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!hasConfiguredProvider) {
      setSection("providers");
    }
  }, [hasConfiguredProvider]);

  const navItems = useMemo<NavItem[]>(
    () =>
      NAV_DEFS.map((item) => ({
        id: item.id,
        icon: item.icon,
        label: t(item.labelKey),
        group: t(item.groupKey)
      })),
    [t]
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return navItems;
    }
    return navItems.filter((item) => item.label.toLowerCase().includes(needle));
  }, [navItems, query]);

  const groups = useMemo(() => {
    const map = new Map<string, NavItem[]>();
    for (const item of filtered) {
      const list = map.get(item.group) ?? [];
      list.push(item);
      map.set(item.group, list);
    }
    return [...map.entries()];
  }, [filtered]);

  return (
    <div className="grid h-screen min-h-0 min-w-0 flex-1 grid-cols-[272px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-hidden bg-background">
      {/* Settings nav */}
      <aside className="flex h-full min-h-0 flex-col gap-1 overflow-y-auto border-r border-border bg-background px-3 pb-4">
        <div className="h-10 flex-none [-webkit-app-region:drag]" />
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-full justify-start gap-2 px-2 text-muted-foreground"
          onClick={() => setView(activeSessionId ? "chat" : "home")}
        >
          <ArrowLeft className="size-4" />
          {t("settings.back")}
        </Button>
        <div className="relative my-2">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("settings.searchPlaceholder")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-9 pl-8"
          />
        </div>
        {groups.map(([group, items]) => (
          <div key={group} className="mb-2">
            <div className="px-2 py-1.5 font-mono text-[11px] uppercase tracking-[0.28px] text-muted-slate">
              {group}
            </div>
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSection(item.id)}
                  className={cn(
                    "group flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-caption transition-colors",
                    section === item.id
                      ? "bg-canvas-soft-2 font-medium text-foreground"
                      : "text-foreground hover:bg-canvas-soft-2/80"
                  )}
                >
                  <Icon
                    className={cn(
                      "size-[18px] transition-colors",
                      section === item.id ? "text-foreground" : "text-muted-foreground"
                    )}
                  />
                  {item.label}
                </button>
              );
            })}
          </div>
        ))}
        {groups.length === 0 ? (
          <p className="px-2.5 py-2 text-caption text-muted-foreground">{t("settings.noResults")}</p>
        ) : null}
      </aside>

      {/* 内容区保持 Vercel 式近白平面，主要靠导航边线建立层级。 */}
      <div className="h-screen min-h-0 overflow-y-auto bg-background px-12 pb-16 pt-16">
        <div className="mx-auto max-w-[820px]">
          {section === "appearance" ? <AppearanceSection /> : null}
          {section === "general" ? <GeneralSection /> : null}
          {section === "providers" ? <ProvidersSection /> : null}
          {section === "usage" ? <UsageStatsSection /> : null}
          {section === "skills" ? <SkillsSection /> : null}
          {section === "webSearch" ? <WebSearchSection /> : null}
        </div>
      </div>
    </div>
  );
}

function AppearanceSection() {
  const { t } = useTranslation();
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  return (
    <SectionShell title={t("settings.appearance.title")}>
      <SettingBlock
        title={t("settings.appearance.themeTitle")}
        description={t("settings.appearance.themeDesc")}
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <OptionCard
            selected={theme === "light"}
            icon={<Sun />}
            title={t("settings.appearance.light")}
            description={t("settings.appearance.lightDesc")}
            onSelect={() => setTheme("light")}
          />
          <OptionCard
            selected={theme === "dark"}
            icon={<Moon />}
            title={t("settings.appearance.dark")}
            description={t("settings.appearance.darkDesc")}
            onSelect={() => setTheme("dark")}
          />
          <OptionCard
            selected={theme === "system"}
            icon={<Laptop />}
            title={t("settings.appearance.system")}
            description={t("settings.appearance.systemDesc")}
            onSelect={() => setTheme("system")}
          />
        </div>
      </SettingBlock>
    </SectionShell>
  );
}

function GeneralSection() {
  const { t } = useTranslation();
  const locale = useAppStore((state) => state.locale);
  const setLocale = useAppStore((state) => state.setLocale);
  const [logsStatus, setLogsStatus] = useState("");
  return (
    <SectionShell title={t("settings.general.title")}>
      <SettingBlock
        title={t("settings.general.langTitle")}
        description={t("settings.general.langDesc")}
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <OptionCard
            selected={locale === "zh"}
            icon={<Languages />}
            title={t("settings.general.langZh")}
            description={t("settings.general.langZhDesc")}
            onSelect={() => setLocale("zh")}
          />
          <OptionCard
            selected={locale === "en"}
            icon={<Globe />}
            title={t("settings.general.langEn")}
            description={t("settings.general.langEnDesc")}
            onSelect={() => setLocale("en")}
          />
        </div>
      </SettingBlock>
      {import.meta.env.DEV ? (
        <SettingBlock
          title={t("settings.general.logsTitle")}
          description={t("settings.general.logsDesc")}
        >
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              setLogsStatus("");
              if (!window.chengxiaobang?.openLogDir) {
                console.warn("[settings] 日志目录打开失败：当前环境没有桌面 bridge");
                setLogsStatus(t("settings.general.logsDesktopOnly"));
                return;
              }
              const result = await window.chengxiaobang.openLogDir();
              if (!result.ok) {
                console.warn("[settings] 日志目录打开失败", result);
                setLogsStatus(result.error ?? t("settings.general.logsOpenFailed"));
                return;
              }
              console.info("[settings] 已请求打开日志目录", { path: result.path });
              setLogsStatus(t("settings.general.logsOpened", { path: result.path }));
            }}
          >
            <FolderOpen className="size-4" />
            {t("settings.general.openLogs")}
          </Button>
          {logsStatus ? (
            <span className="ml-3 align-middle text-caption text-muted-foreground">
              {logsStatus}
            </span>
          ) : null}
        </SettingBlock>
      ) : null}
    </SectionShell>
  );
}

function providerDraftFromPreset(
  kind: ProviderKind,
  options: { id?: string; apiKey?: string; modelIds?: string[] } = {}
): ProviderInput {
  const preset = PROVIDER_PRESETS[kind];
  const models = normalizeDraftModels(kind, options.modelIds ?? preset.models ?? defaultModelIds(kind));
  return {
    ...preset,
    id: options.id,
    apiKey: options.apiKey,
    models,
    model: models.includes(preset.model) ? preset.model : models[0] ?? preset.model
  };
}

function applyDraftModels(draft: ProviderInput, modelIds: string[]): ProviderInput {
  const models = normalizeDraftModels(draft.kind, modelIds, { allowEmpty: true });
  return {
    ...draft,
    models,
    model: models.includes(draft.model) ? draft.model : models[0] ?? draft.model
  };
}

function normalizeDraftModels(
  kind: ProviderKind,
  modelIds: string[],
  options: { allowEmpty?: boolean } = {}
): string[] {
  return normalizeModelIds(kind, modelIds, options);
}

function ProvidersSection() {
  const { t } = useTranslation();
  const confirmDialog = useConfirmDialog();
  const providers = useAppStore(useShallow((state) => state.providers));
  const saveProvider = useAppStore((state) => state.saveProvider);
  const deleteProvider = useAppStore((state) => state.deleteProvider);
  const testProvider = useAppStore((state) => state.testProvider);

  // draft 为空 = 新建的「先选类型」阶段；选好类型或点击列表项后才展开表单。
  const [draft, setDraft] = useState<ProviderInput>();
  const [errors, setErrors] = useState<ProviderDraftErrors>({});
  const [status, setStatus] = useState("");

  const editingProvider = draft?.id
    ? providers.find((provider) => provider.id === draft.id)
    : undefined;
  const hasStoredKey = Boolean(editingProvider?.apiKeyRef);
  const configuredProviders = providers.filter((provider) => provider.apiKeyRef);

  const resetForm = () => {
    setDraft(undefined);
    setErrors({});
    setStatus("");
  };

  async function confirmDeleteProvider(
    provider: { id: string; name: string }
  ): Promise<boolean> {
    console.debug("[settings] 请求删除供应商", { providerId: provider.id, name: provider.name });
    const confirmed = await confirmDialog({
      title: t("settings.providers.deleteTitle", { name: provider.name }),
      description: t("settings.providers.deleteConfirm"),
      confirmLabel: t("settings.providers.delete"),
      cancelLabel: t("settings.providers.cancel"),
      tone: "danger",
      source: "settings.deleteProvider"
    });
    console.debug("[settings] 供应商删除确认结果", {
      providerId: provider.id,
      name: provider.name,
      confirmed
    });
    return confirmed;
  }

  const startCreate = (kind: ProviderKind, modelIds: string[]) => {
    const preset = providerDraftFromPreset(kind, { apiKey: "", modelIds });
    console.debug("[settings] 选择新增供应商模板", { kind, region: preset.region });
    setDraft(preset);
    setErrors({});
    setStatus("");
  };

  const startEdit = (provider: ProviderConfig) => {
    setDraft({
      id: provider.id,
      kind: provider.kind,
      name: provider.name,
      baseURL: provider.baseURL,
      model: provider.model,
      region: provider.region,
      api: provider.api,
      auth: provider.auth,
      models: normalizeDraftModels(provider.kind, provider.models ?? defaultModelIds(provider.kind)),
      apiKey: ""
    });
    setErrors({});
    setStatus("");
  };

  return (
    <SectionShell title={t("settings.providers.title")}>
      {configuredProviders.length === 0 ? (
        <div className="rounded-sm border bg-link-bg-soft px-4 py-3 text-ink text-caption">
          {t("settings.providers.required")}
        </div>
      ) : null}
      <SettingBlock
        title={t("settings.providers.configYamlTitle")}
        description={t("settings.providers.configYamlDesc")}
      >
        <Button
          type="button"
          variant="outline"
          onClick={async () => {
            if (!window.chengxiaobang?.openProviderConfig) {
              setStatus(t("settings.providers.configYamlDesktopOnly"));
              return;
            }
            const result = await window.chengxiaobang.openProviderConfig();
            setStatus(
              result.ok
                ? t("settings.providers.configYamlOpened")
                : result.error ?? t("settings.providers.configYamlOpenFailed")
            );
          }}
        >
          <FolderOpen className="size-4" />
          {t("settings.providers.openConfigYaml")}
        </Button>
      </SettingBlock>
      <SettingBlock
        title={t("settings.providers.configuredTitle")}
        description={t("settings.providers.configuredDesc")}
      >
        <div data-testid="settings-provider-list" className="divide-y rounded-sm border bg-background">
          {configuredProviders.length === 0 ? (
            <div className="px-4 py-4 text-caption text-muted-foreground">
              {t("settings.providers.empty")}
            </div>
          ) : (
            configuredProviders.map((provider) => {
              const selected = draft?.id === provider.id;
              const subtitle =
                provider.models && provider.models.length > 1
                  ? t("settings.providers.modelsSummary", { count: provider.models.length })
                  : provider.model;
              return (
                <div
                  key={provider.id}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 transition-colors",
                    selected ? "bg-canvas-soft-2" : "hover:bg-canvas-soft-2/70"
                  )}
                >
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => startEdit(provider)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-caption font-medium">{provider.name}</span>
                      </span>
                      <span className="block truncate text-micro text-muted-foreground">
                        {subtitle}
                      </span>
                    </span>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("settings.providers.deleteNamed", { name: provider.name })}
                    title={t("settings.providers.delete")}
                    className="size-8 flex-none rounded-xs text-muted-foreground hover:text-destructive"
                    onClick={async () => {
                      if (!(await confirmDeleteProvider(provider))) {
                        return;
                      }
                      await deleteProvider(provider.id);
                      if (draft?.id === provider.id) {
                        resetForm();
                      }
                      setStatus(t("settings.providers.deleted"));
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </SettingBlock>

      <SettingBlock
        title={draft?.id ? t("settings.providers.edit") : t("settings.providers.create")}
      >
        <div data-testid="settings-provider-form" className="rounded-sm border bg-background p-6">
          {!draft ? (
            <div className="grid gap-4">
              <p className="text-caption text-muted-foreground">
                {t("settings.providers.chooseTypeDesc")}
              </p>
              <Field label={t("settings.providers.provider")}>
                <ProviderCascadeSelect
                  ariaLabel={t("settings.providers.provider")}
                  options={PROVIDER_KIND_OPTIONS}
                  placeholder={t("settings.providers.cascadePlaceholder")}
                  onValueChange={startCreate}
                />
              </Field>
            </div>
          ) : (
            <form
              noValidate
              className="grid gap-4"
              onSubmit={async (event) => {
                event.preventDefault();
                const validation = validateProviderDraft(draft, { hasStoredKey });
                setErrors(validation);
                if (Object.values(validation).some(Boolean)) {
                  console.warn("[settings] 供应商表单校验未通过", validation);
                  return;
                }
                try {
                  const providerDraft: ProviderInput = { ...draft };
                  delete providerDraft.modelOverrides;
                  // 最大工具调用轮数由 shared catalog/YAML 维护，设置页不向后端提交用户级覆盖。
                  await saveProvider({
                    ...providerDraft,
                    name: draft.name.trim(),
                    baseURL: draft.baseURL.trim()
                  });
                  setStatus(t("settings.providers.saved"));
                  if (draft.id) {
                    setDraft({ ...providerDraft, apiKey: "" });
                  } else {
                    // 新建成功后回到「先选类型」阶段。
                    setDraft(undefined);
                  }
                } catch (cause) {
                  console.error("[settings] 保存供应商失败", cause);
                  setStatus(cause instanceof Error ? cause.message : String(cause));
                }
              }}
            >
              <Field label={t("settings.providers.type")}>
                <ProviderCascadeSelect
                  value={draft.kind}
                  ariaLabel={t("settings.providers.type")}
                  options={PROVIDER_KIND_OPTIONS}
                  placeholder={t("settings.providers.cascadePlaceholder")}
                  selectedModelIds={draft.models}
                  onSelectedModelIdsChange={(modelIds) => {
                    setDraft(applyDraftModels(draft, modelIds));
                    setErrors({});
                  }}
                  onValueChange={(kind, modelIds) => {
                    const preset = providerDraftFromPreset(kind, {
                      id: draft.id,
                      apiKey: draft.apiKey,
                      modelIds
                    });
                    setDraft(preset);
                    setErrors({});
                  }}
                />
              </Field>
              <Field
                label={t("settings.providers.selectedModels")}
                error={errors.model ? t(errors.model) : undefined}
              >
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
                    setErrors({});
                  }}
                />
              </Field>
              <Field label="Base URL" error={errors.baseURL ? t(errors.baseURL) : undefined}>
                <Input
                  aria-label="Base URL"
                  value={draft.baseURL}
                  onChange={(event) => setDraft({ ...draft, baseURL: event.target.value })}
                />
              </Field>
              <Field label="API Key" error={errors.apiKey ? t(errors.apiKey) : undefined}>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    aria-label="API Key"
                    value={draft.apiKey ?? ""}
                    placeholder={hasStoredKey ? t("settings.providers.keepKey") : undefined}
                    onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
                  />
                  {API_KEY_URLS[draft.kind] ? (
                    <Button variant="outline" asChild>
                      <ExternalUrlAnchor
                        href={API_KEY_URLS[draft.kind]!}
                        title={t("settings.providers.getApiKey")}
                      >
                        <ExternalLink className="size-4" />
                        {t("settings.providers.getApiKey")}
                      </ExternalUrlAnchor>
                    </Button>
                  ) : null}
                </div>
              </Field>
              <div className="flex items-center gap-3 pt-1">
                <Button type="submit">{t("settings.providers.save")}</Button>
                {draft.id ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await testProvider(draft.id!);
                        setStatus(t("settings.providers.connectionOk"));
                      } catch (cause) {
                        console.error("[settings] 测试连接失败", cause);
                        setStatus(cause instanceof Error ? cause.message : String(cause));
                      }
                    }}
                  >
                    {t("settings.providers.test")}
                  </Button>
                ) : null}
                <Button type="button" variant="ghost" onClick={resetForm}>
                  {t("settings.providers.cancel")}
                </Button>
                {draft.id ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={async () => {
                      if (!(await confirmDeleteProvider({ id: draft.id!, name: draft.name }))) {
                        return;
                      }
                      await deleteProvider(draft.id!);
                      resetForm();
                      setStatus(t("settings.providers.deleted"));
                    }}
                  >
                    <Trash2 className="size-4" />
                    {t("settings.providers.delete")}
                  </Button>
                ) : null}
                <span className="text-caption text-muted-foreground">{status}</span>
              </div>
            </form>
          )}
        </div>
      </SettingBlock>
    </SectionShell>
  );
}

export function SkillsSection() {
  const { t } = useTranslation();
  const slashCommands = useAppStore(useShallow((state) => state.slashCommands));
  const refreshSlashCommands = useAppStore((state) => state.refreshSlashCommands);
  const setNotice = useAppStore((state) => state.setNotice);

  useEffect(() => {
    void refreshSlashCommands();
  }, [refreshSlashCommands]);

  const sourceLabel: Record<string, string> = {
    builtin: t("composer.slashSource.builtin"),
    global: t("composer.slashSource.global"),
    project: t("composer.slashSource.project"),
    market: t("composer.slashSource.market")
  };

  return (
    <SectionShell title={t("settings.skills.title")}>
      <SettingBlock
        title={t("settings.skills.listTitle")}
        description={t("settings.skills.listDesc")}
      >
        <div data-testid="settings-skills-list" className="divide-y rounded-sm border bg-background">
          {slashCommands.length === 0 ? (
            <div className="px-4 py-4 text-caption text-muted-foreground">
              {t("settings.skills.empty")}
            </div>
          ) : (
            slashCommands.map((command) => (
              <div key={command.id} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5 rounded-xs bg-muted px-1.5 py-0.5 font-mono text-micro text-foreground">
                  {command.name}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-caption text-muted-foreground">
                    {command.description || t("composer.slashNoDescription")}
                  </div>
                </div>
                <span className="flex-none text-micro text-muted-slate">
                  {sourceLabel[command.source] ?? command.source}
                </span>
              </div>
            ))
          )}
        </div>
      </SettingBlock>

      <SettingBlock
        title={t("settings.skills.manageTitle")}
        description={t("settings.skills.manageDesc")}
      >
        <Button
          variant="outline"
          onClick={async () => {
            if (!window.chengxiaobang?.openSkillsDir) {
              setNotice(t("settings.skills.desktopOnly"));
              return;
            }
            await window.chengxiaobang.openSkillsDir();
          }}
        >
          <FolderOpen className="size-4" />
          {t("settings.skills.openDir")}
        </Button>
      </SettingBlock>
    </SectionShell>
  );
}

function Field(props: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label className="text-muted-foreground">{props.label}</Label>
      {props.children}
      {props.error ? <p className="text-micro text-destructive">{props.error}</p> : null}
    </div>
  );
}
