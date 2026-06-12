import {
  ArrowLeftIcon as ArrowLeft,
  ArrowSquareOutIcon as ExternalLink,
  ChatCenteredTextIcon as MessageSquareText,
  CircleHalfTiltIcon as SunMoon,
  FolderOpenIcon as FolderOpen,
  GlobeIcon as Globe,
  LaptopIcon as Laptop,
  LockKeyIcon as LockKeyhole,
  MagnifyingGlassIcon as Search,
  MoonIcon as Moon,
  ShieldCheckIcon as ShieldCheck,
  SlidersHorizontalIcon as SlidersHorizontal,
  SparkleIcon as Sparkles,
  StackIcon as Boxes,
  SunIcon as Sun,
  TranslateIcon as Languages,
  TrashIcon as Trash2,
  XIcon as X,
  type Icon
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  mergeProviderModelOptions,
  resolveProviderModelOption,
  type ProviderConfig,
  type ProviderInput,
  type ProviderKind,
  type ProviderModelOption
} from "@chengxiaobang/shared";
import { useShallow } from "zustand/react/shallow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { FeishuSection } from "@/components/settings/FeishuSection";
import { OptionCard } from "@/components/settings/OptionCard";
import { SectionShell, SettingBlock } from "@/components/settings/SectionShell";
import {
  ReasoningModeSelect,
  reasoningModeSummary,
  supportedReasoningMode
} from "@/components/ProviderModelControls";
import { API_KEY_URLS, PROVIDER_KIND_OPTIONS, PROVIDER_PRESETS } from "@/lib/provider-presets";
import {
  isCatalogProvider,
  validateProviderDraft,
  type ProviderDraftErrors
} from "@/lib/provider-validation";
import { cn } from "@/lib/utils";
import { getApiClient, useAppStore } from "@/store";

type SectionId = "appearance" | "general" | "providers" | "skills" | "feishu";

interface NavDef {
  id: SectionId;
  labelKey:
    | "settings.nav.appearance"
    | "settings.nav.general"
    | "settings.nav.providers"
    | "settings.nav.skills"
    | "settings.nav.feishu";
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
  { id: "skills", labelKey: "settings.nav.skills", icon: Sparkles, groupKey: "settings.groupModel" },
  { id: "feishu", labelKey: "settings.nav.feishu", icon: MessageSquareText, groupKey: "settings.groupIntegrations" }
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
          {section === "skills" ? <SkillsSection /> : null}
          {section === "feishu" ? <FeishuSection /> : null}
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
  const accessMode = useAppStore((state) => state.accessMode);
  const setAccessMode = useAppStore((state) => state.setAccessMode);
  const locale = useAppStore((state) => state.locale);
  const setLocale = useAppStore((state) => state.setLocale);
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
      <SettingBlock
        title={t("settings.general.permTitle")}
        description={t("settings.general.permDesc")}
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <OptionCard
            selected={accessMode === "approval"}
            icon={<LockKeyhole />}
            title={t("settings.general.approval")}
            description={t("settings.general.approvalDesc")}
            onSelect={() => setAccessMode("approval")}
          />
          <OptionCard
            selected={accessMode === "full_access"}
            icon={<ShieldCheck />}
            title={t("settings.general.full")}
            description={t("settings.general.fullDesc")}
            onSelect={() => setAccessMode("full_access")}
          />
        </div>
      </SettingBlock>
    </SectionShell>
  );
}

function ProvidersSection() {
  const { t } = useTranslation();
  const providers = useAppStore(useShallow((state) => state.providers));
  const activeProviderId = useAppStore((state) => state.providerId);
  const saveProvider = useAppStore((state) => state.saveProvider);
  const deleteProvider = useAppStore((state) => state.deleteProvider);
  const testProvider = useAppStore((state) => state.testProvider);

  // draft 为空 = 新建的「先选类型」阶段；选好类型或点击列表项后才展开表单。
  const [draft, setDraft] = useState<ProviderInput>();
  const [errors, setErrors] = useState<ProviderDraftErrors>({});
  const [status, setStatus] = useState("");
  const [remoteOptions, setRemoteOptions] = useState<ProviderModelOption[]>([]);

  const editingProvider = draft?.id
    ? providers.find((provider) => provider.id === draft.id)
    : undefined;
  const hasStoredKey = Boolean(editingProvider?.apiKeyRef);
  // 「使用中」与输入框实际使用的供应商一致：选中的优先，否则第一个已配 Key 的。
  const configuredProviders = providers.filter((provider) => provider.apiKeyRef);
  const activeProvider =
    configuredProviders.find((provider) => provider.id === activeProviderId) ??
    configuredProviders[0];

  const draftId = draft?.id;
  useEffect(() => {
    let cancelled = false;
    setRemoteOptions([]);
    if (!draftId) {
      return () => {
        cancelled = true;
      };
    }
    const client = getApiClient();
    if (!client) {
      return () => {
        cancelled = true;
      };
    }
    void client
      .listProviderModelOptions(draftId)
      .then((options) => {
        if (!cancelled) {
          setRemoteOptions(options);
        }
      })
      .catch((error) => {
        console.warn("[settings] 拉取模型选项失败，使用静态目录", {
          providerId: draftId,
          error
        });
      });
    return () => {
      cancelled = true;
    };
  }, [draftId]);

  const modelOptions = useMemo(() => {
    if (!draft) {
      return [];
    }
    const base =
      remoteOptions.length > 0
        ? remoteOptions
        : mergeProviderModelOptions(draft.kind, [], draft.model);
    return withDraftModels(draft.kind, base, draft);
  }, [draft, remoteOptions]);

  const resetForm = () => {
    setDraft(undefined);
    setErrors({});
    setStatus("");
  };

  const startCreate = (kind: ProviderKind) => {
    const preset = PROVIDER_PRESETS[kind];
    setDraft({
      ...preset,
      apiKey: "",
      // 目录型默认勾选全部内置模型；自定义型不内置假模型，由用户自行添加。
      models: isCatalogProvider(kind)
        ? mergeProviderModelOptions(kind, [], preset.model).map((option) => option.id)
        : preset.model
          ? [preset.model]
          : []
    });
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
      models:
        provider.models ??
        (isCatalogProvider(provider.kind)
          ? mergeProviderModelOptions(provider.kind, [], provider.model).map(
              (option) => option.id
            )
          : [provider.model]),
      reasoningMode: provider.reasoningMode,
      apiKey: ""
    });
    setErrors({});
    setStatus("");
  };

  // 自定义供应商手填模型列表；默认模型跟随列表第一个（若原默认被移除）。
  const setCustomModels = (models: string[]) => {
    setDraft((current) => {
      if (!current) {
        return current;
      }
      const model = models.includes(current.model) ? current.model : models[0] ?? "";
      return {
        ...current,
        models,
        model,
        reasoningMode: supportedReasoningMode(current.kind, model, current.reasoningMode)
      };
    });
  };

  // 勾选/取消模型；默认模型被取消时回退到剩余的第一个。
  const toggleModel = (modelId: string) => {
    setDraft((current) => {
      if (!current?.models) {
        return current;
      }
      const models = current.models.includes(modelId)
        ? current.models.filter((id) => id !== modelId)
        : [...current.models, modelId];
      const model = models.includes(current.model) ? current.model : models[0] ?? current.model;
      return {
        ...current,
        models,
        model,
        reasoningMode: supportedReasoningMode(current.kind, model, current.reasoningMode)
      };
    });
  };

  return (
    <SectionShell title={t("settings.providers.title")}>
      {configuredProviders.length === 0 ? (
        <div className="rounded-sm border bg-link-bg-soft px-4 py-3 text-ink text-caption">
          {t("settings.providers.required")}
        </div>
      ) : null}
      <SettingBlock
        title={t("settings.providers.configuredTitle")}
        description={t("settings.providers.configuredDesc")}
      >
        <div data-testid="settings-provider-list" className="divide-y rounded-sm border bg-background">
          {providers.length === 0 ? (
            <div className="px-4 py-4 text-caption text-muted-foreground">
              {t("settings.providers.empty")}
            </div>
          ) : (
            providers.map((provider) => {
              const selected = draft?.id === provider.id;
              const inUse = provider.id === activeProvider?.id;
              const configured = Boolean(provider.apiKeyRef);
              const option = resolveProviderModelOption(provider.kind, provider.model);
              const subtitle =
                provider.models && provider.models.length > 1
                  ? t("settings.providers.modelsSummary", { count: provider.models.length })
                  : `${provider.model} · ${reasoningModeSummary(t, option, provider.reasoningMode)}`;
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
                        {inUse ? (
                          <span className="flex-none rounded-xs bg-primary px-1.5 py-0.5 text-micro text-primary-foreground">
                            {t("settings.providers.inUse")}
                          </span>
                        ) : null}
                      </span>
                      <span className="block truncate text-micro text-muted-foreground">
                        {subtitle}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "flex-none rounded-xs border px-1.5 py-0.5 text-micro",
                        configured
                          ? "text-muted-foreground"
                          : "border-warning text-warning-deep"
                      )}
                    >
                      {configured
                        ? t("settings.providers.statusConfigured")
                        : t("settings.providers.statusMissing")}
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
                      if (!window.confirm(t("settings.providers.deleteConfirm"))) {
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
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {PROVIDER_KIND_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => startCreate(option.value)}
                    className="rounded-sm border bg-canvas px-4 py-3 text-left text-caption font-medium transition-colors hover:bg-canvas-soft-2"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <form
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
                  await saveProvider({
                    ...draft,
                    name: draft.name.trim(),
                    baseURL: draft.baseURL.trim()
                  });
                  setStatus(t("settings.providers.saved"));
                  if (draft.id) {
                    setDraft({ ...draft, apiKey: "" });
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
                <Select
                  value={draft.kind}
                  onValueChange={(value) => {
                    const kind = value as ProviderKind;
                    const preset = PROVIDER_PRESETS[kind];
                    setDraft({
                      ...preset,
                      id: draft.id,
                      apiKey: draft.apiKey,
                      models: isCatalogProvider(kind)
                        ? mergeProviderModelOptions(kind, [], preset.model).map(
                            (option) => option.id
                          )
                        : preset.model
                          ? [preset.model]
                          : [],
                      reasoningMode: undefined
                    });
                    setErrors({});
                  }}
                >
                  <SelectTrigger>
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
              </Field>
              <Field
                label={t("settings.providers.name")}
                error={errors.name ? t(errors.name) : undefined}
              >
                <Input
                  aria-label={t("settings.providers.name")}
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </Field>
              <Field label="Base URL" error={errors.baseURL ? t(errors.baseURL) : undefined}>
                <Input
                  aria-label="Base URL"
                  value={draft.baseURL}
                  onChange={(event) => setDraft({ ...draft, baseURL: event.target.value })}
                />
              </Field>
              <Field
                label={t("settings.providers.includedModels")}
                error={errors.model ? t(errors.model) : undefined}
              >
                {isCatalogProvider(draft.kind) ? (
                  <ModelChecklist
                    options={modelOptions}
                    selected={draft.models ?? []}
                    onToggle={toggleModel}
                  />
                ) : (
                  <ModelTagEditor models={draft.models ?? []} onChange={setCustomModels} />
                )}
              </Field>
              <Field label={t("settings.providers.reasoning")}>
                <ReasoningModeSelect
                  kind={draft.kind}
                  model={draft.model}
                  value={supportedReasoningMode(draft.kind, draft.model, draft.reasoningMode)}
                  onValueChange={(reasoningMode) => setDraft({ ...draft, reasoningMode })}
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
                      <a
                        href={API_KEY_URLS[draft.kind]}
                        target="_blank"
                        rel="noreferrer"
                        title={t("settings.providers.getApiKey")}
                      >
                        <ExternalLink className="size-4" />
                        {t("settings.providers.getApiKey")}
                      </a>
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
                      if (!window.confirm(t("settings.providers.deleteConfirm"))) {
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

function SkillsSection() {
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
    project: t("composer.slashSource.project")
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

/** 多选模型清单：一个 API Key 下勾选要启用的模型。 */
function ModelChecklist(props: {
  options: ProviderModelOption[];
  selected: string[];
  onToggle(id: string): void;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-sm border bg-canvas">
      <div className="max-h-[240px] divide-y overflow-y-auto">
        {props.options.map((option) => (
          <label
            key={option.id}
            className="flex cursor-pointer items-center gap-2.5 px-3 py-2.5 transition-colors hover:bg-canvas-soft-2/70"
          >
            <input
              type="checkbox"
              checked={props.selected.includes(option.id)}
              onChange={() => props.onToggle(option.id)}
              className="size-4 flex-none accent-primary"
            />
            <span className="min-w-0 flex-1 truncate text-caption font-medium">
              {modelOptionLabel(option)}
            </span>
          </label>
        ))}
      </div>
      <div className="border-t px-3 py-2 text-micro text-muted-foreground">
        {t("settings.providers.selectedCount", { count: props.selected.length })}
      </div>
    </div>
  );
}

/** 自定义供应商的模型清单：手动输入模型 ID，可增删，同一个 API Key 下生效。 */
function ModelTagEditor(props: { models: string[]; onChange(models: string[]): void }) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const addModel = () => {
    const id = value.trim();
    if (!id) {
      return;
    }
    if (!props.models.includes(id)) {
      props.onChange([...props.models, id]);
    }
    setValue("");
  };
  return (
    <div className="grid gap-2">
      {props.models.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {props.models.map((model) => (
            <Badge
              key={model}
              variant="secondary"
              className="gap-1.5 py-1 pl-2.5 pr-1 font-normal"
            >
              <span className="font-mono text-micro">{model}</span>
              <button
                type="button"
                aria-label={t("settings.providers.removeModel", { model })}
                onClick={() => props.onChange(props.models.filter((id) => id !== model))}
                className="flex size-4 items-center justify-center rounded-xs text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
      <div className="flex gap-2">
        <Input
          value={value}
          placeholder={t("settings.providers.modelPlaceholder")}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            // Enter 直接添加，避免触发表单提交。
            if (event.key === "Enter") {
              event.preventDefault();
              addModel();
            }
          }}
        />
        <Button type="button" variant="outline" onClick={addModel}>
          {t("settings.providers.addModel")}
        </Button>
      </div>
    </div>
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

/** 把草稿中已勾选/默认的模型补进选项列表，避免目录之外的模型丢失。 */
function withDraftModels(
  kind: ProviderKind,
  options: ProviderModelOption[],
  draft: ProviderInput
): ProviderModelOption[] {
  const known = new Set(options.map((option) => option.id));
  const extras = [...new Set([...(draft.models ?? []), draft.model])].filter(
    (model) => model && !known.has(model)
  );
  if (extras.length === 0) {
    return options;
  }
  return [...options, ...extras.map((model) => resolveProviderModelOption(kind, model))];
}

function modelOptionLabel(option: ProviderModelOption): string {
  return option.label ?? option.id;
}
