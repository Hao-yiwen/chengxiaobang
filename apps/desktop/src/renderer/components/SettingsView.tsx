import type { ComponentType } from "react";
import {
  ArrowLeftIcon,
  ArrowTopRightIcon,
  ChevronIcon,
  FilterLinesIcon,
  FolderOpenOutlineIcon,
  GlobeOutlineIcon,
  LaptopIcon,
  LightbulbRaysIcon,
  MoonOutlineIcon,
  PluginFocusCornersIcon,
  PricingUsageTrendIcon,
  SearchIcon,
  SitesGridOutlineIcon,
  SunIcon,
  TerminalIcon,
  TrashIcon,
  type FileIconSvgProps
} from "@/assets/file-type-icons";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  type ProviderConfig,
  type ProviderInput,
  type ProviderKind
} from "@chengxiaobang/shared";
import { useShallow } from "zustand/react/shallow";
import { useConfirmDialog } from "@/components/ConfirmDialog";
import { CodePreviewLines } from "@/components/CodePreviewLines";
import { ExternalUrlAnchor } from "@/components/ExternalUrlMenu";
import {
  defaultModelIds,
  normalizeModelIds,
  ProviderCascadeSelect,
  ProviderModelTags
} from "@/components/ProviderCascadeSelect";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { CommandsSection } from "@/components/settings/CommandsSection";
import { OptionCard } from "@/components/settings/OptionCard";
import { PluginsSection } from "@/components/settings/PluginsSection";
import { SectionShell, SettingBlock } from "@/components/settings/SectionShell";
import { SkillsSection } from "@/components/settings/SkillsSection";
import { UsageStatsSection } from "@/components/settings/UsageStatsSection";
import { WebSearchSection } from "@/components/settings/WebSearchSection";
import {
  CODE_PREVIEW_FONT_SIZE_MAX,
  CODE_PREVIEW_FONT_SIZE_MIN,
  CODE_PREVIEW_THEME_OPTIONS,
  codePreviewThemeLabel,
  type CodePreviewSettings,
  type CodePreviewThemeId
} from "@/lib/code-preview-settings";
import {
  codePreviewInlineStyle,
  normalizeCodePreviewText,
  splitCodePreviewLines,
  useShikiHighlight
} from "@/lib/code-highlight";
import { API_KEY_URLS, PROVIDER_KIND_OPTIONS, PROVIDER_PRESETS } from "@/lib/provider-presets";
import {
  validateProviderDraft,
  type ProviderDraftErrors
} from "@/lib/provider-validation";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

type Icon = ComponentType<FileIconSvgProps>;

type SectionId =
  | "appearance"
  | "general"
  | "providers"
  | "usage"
  | "skills"
  | "plugins"
  | "commands"
  | "webSearch";

interface NavDef {
  id: SectionId;
  labelKey:
    | "settings.nav.appearance"
    | "settings.nav.general"
    | "settings.nav.providers"
    | "settings.nav.usage"
    | "settings.nav.skills"
    | "settings.nav.plugins"
    | "settings.nav.commands"
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
  { id: "appearance", labelKey: "settings.nav.appearance", icon: SunIcon, groupKey: "settings.groupPersonal" },
  { id: "general", labelKey: "settings.nav.general", icon: FilterLinesIcon, groupKey: "settings.groupPersonal" },
  { id: "providers", labelKey: "settings.nav.providers", icon: SitesGridOutlineIcon, groupKey: "settings.groupModel" },
  { id: "usage", labelKey: "settings.nav.usage", icon: PricingUsageTrendIcon, groupKey: "settings.groupModel" },
  { id: "skills", labelKey: "settings.nav.skills", icon: LightbulbRaysIcon, groupKey: "settings.groupModel" },
  { id: "plugins", labelKey: "settings.nav.plugins", icon: PluginFocusCornersIcon, groupKey: "settings.groupModel" },
  { id: "commands", labelKey: "settings.nav.commands", icon: TerminalIcon, groupKey: "settings.groupModel" },
  { id: "webSearch", labelKey: "settings.nav.webSearch", icon: GlobeOutlineIcon, groupKey: "settings.groupIntegrations" }
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
  const pendingSettingsSection = useAppStore((state) => state.pendingSettingsSection);
  const clearPendingSettingsSection = useAppStore((state) => state.clearPendingSettingsSection);

  const [section, setSection] = useState<SectionId>(
    hasConfiguredProvider ? "appearance" : "providers"
  );
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!hasConfiguredProvider) {
      setSection("providers");
    }
  }, [hasConfiguredProvider]);

  // 外部（如输入框「管理技能」）请求打开设置并定位到指定分区时消费一次。
  useEffect(() => {
    if (pendingSettingsSection) {
      console.debug("[settings-view] 定位到外部请求的设置分区", {
        section: pendingSettingsSection
      });
      setSection(pendingSettingsSection as SectionId);
      clearPendingSettingsSection();
    }
  }, [pendingSettingsSection, clearPendingSettingsSection]);

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
      <aside className="scrollbar-hidden flex h-full min-h-0 flex-col gap-1 overflow-y-auto border-r border-border bg-background px-3 pb-4">
        <div className="h-10 flex-none [-webkit-app-region:drag]" />
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-full justify-start gap-2 px-2 text-foreground hover:text-foreground [&_svg]:text-foreground"
          onClick={() => setView(activeSessionId ? "chat" : "home")}
        >
          <ArrowLeftIcon className="size-4" />
          {t("settings.back")}
        </Button>
        <div className="relative my-2">
          <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
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
                    className="size-[18px] text-foreground transition-colors"
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
      <div className="scrollbar-hidden h-screen min-h-0 overflow-y-auto bg-background px-12 pb-16 pt-16">
        <div className="mx-auto max-w-[820px]">
          {section === "appearance" ? <AppearanceSection /> : null}
          {section === "general" ? <GeneralSection /> : null}
          {section === "providers" ? <ProvidersSection /> : null}
          {section === "usage" ? <UsageStatsSection /> : null}
          {section === "skills" ? <SkillsSection /> : null}
          {section === "plugins" ? <PluginsSection /> : null}
          {section === "commands" ? <CommandsSection /> : null}
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
  const codePreviewSettings = useAppStore((state) => state.codePreviewSettings);
  const setCodePreviewSettings = useAppStore((state) => state.setCodePreviewSettings);
  const resolvedAppearance = useResolvedAppearance(theme);
  return (
    <SectionShell title={t("settings.appearance.title")}>
      <SettingBlock
        title={t("settings.appearance.themeTitle")}
        description={t("settings.appearance.themeDesc")}
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <OptionCard
            selected={theme === "light"}
            icon={<SunIcon />}
            title={t("settings.appearance.light")}
            description={t("settings.appearance.lightDesc")}
            onSelect={() => setTheme("light")}
          />
          <OptionCard
            selected={theme === "dark"}
            icon={<MoonOutlineIcon />}
            title={t("settings.appearance.dark")}
            description={t("settings.appearance.darkDesc")}
            onSelect={() => setTheme("dark")}
          />
          <OptionCard
            selected={theme === "system"}
            icon={<LaptopIcon />}
            title={t("settings.appearance.system")}
            description={t("settings.appearance.systemDesc")}
            onSelect={() => setTheme("system")}
          />
        </div>
      </SettingBlock>
      <SettingBlock
        title={t("settings.appearance.codePreviewTitle")}
        description={t("settings.appearance.codePreviewDesc")}
      >
        <div className="overflow-hidden rounded-md border bg-canvas">
          <CodePreviewControlRow
            title={t("settings.appearance.codeLightThemeTitle")}
            description={t("settings.appearance.codeLightThemeDesc")}
          >
            <CodeThemeSelect
              ariaLabel={t("settings.appearance.codeLightThemeTitle")}
              value={codePreviewSettings.lightTheme}
              onValueChange={(lightTheme) => setCodePreviewSettings({ lightTheme })}
            />
          </CodePreviewControlRow>
          <CodePreviewControlRow
            title={t("settings.appearance.codeDarkThemeTitle")}
            description={t("settings.appearance.codeDarkThemeDesc")}
          >
            <CodeThemeSelect
              ariaLabel={t("settings.appearance.codeDarkThemeTitle")}
              value={codePreviewSettings.darkTheme}
              onValueChange={(darkTheme) => setCodePreviewSettings({ darkTheme })}
            />
          </CodePreviewControlRow>
          <CodePreviewControlRow
            title={t("settings.appearance.codeWrapTitle")}
            description={t("settings.appearance.codeWrapDesc")}
          >
            <Switch
              aria-label={t("settings.appearance.codeWrapTitle")}
              checked={codePreviewSettings.wrapLongLines}
              onCheckedChange={(wrapLongLines) => setCodePreviewSettings({ wrapLongLines })}
            />
          </CodePreviewControlRow>
          <CodePreviewControlRow
            title={t("settings.appearance.codeFontSizeTitle")}
            description={t("settings.appearance.codeFontSizeDesc")}
          >
            <div className="flex w-[220px] items-center gap-4">
              <Slider
                aria-label={t("settings.appearance.codeFontSizeTitle")}
                min={CODE_PREVIEW_FONT_SIZE_MIN}
                max={CODE_PREVIEW_FONT_SIZE_MAX}
                step={1}
                value={[codePreviewSettings.fontSize]}
                onValueChange={([fontSize]) => {
                  if (fontSize !== undefined) {
                    setCodePreviewSettings({ fontSize });
                  }
                }}
              />
              <span className="w-5 text-right font-mono text-body-sm text-foreground">
                {codePreviewSettings.fontSize}
              </span>
            </div>
          </CodePreviewControlRow>
        </div>
        <div className="mt-8">
          <h3 className="text-body-lg font-medium">{t("settings.appearance.codePreviewLiveTitle")}</h3>
          <p className="mt-1 text-caption text-muted-foreground">
            {t("settings.appearance.codePreviewLiveDesc")}
          </p>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <CodeThemePreviewCard
              active={resolvedAppearance === "light"}
              badge={resolvedAppearance === "light"
                ? t("settings.appearance.codePreviewCurrent")
                : t("settings.appearance.light")}
              settings={codePreviewSettings}
              themeId={codePreviewSettings.lightTheme}
              title={t("settings.appearance.codeLightPreview")}
              variant="light"
            />
            <CodeThemePreviewCard
              active={resolvedAppearance === "dark"}
              badge={resolvedAppearance === "dark"
                ? t("settings.appearance.codePreviewCurrent")
                : t("settings.appearance.dark")}
              settings={codePreviewSettings}
              themeId={codePreviewSettings.darkTheme}
              title={t("settings.appearance.codeDarkPreview")}
              variant="dark"
            />
          </div>
        </div>
      </SettingBlock>
    </SectionShell>
  );
}

function CodePreviewControlRow({
  children,
  description,
  title
}: {
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <div className="flex min-h-[84px] items-center justify-between gap-6 border-b px-4 py-4 last:border-b-0">
      <div className="min-w-0">
        <div className="text-body-sm font-medium text-foreground">{title}</div>
        <p className="mt-1 text-caption text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-none justify-end">{children}</div>
    </div>
  );
}

function CodeThemeSelect({
  ariaLabel,
  onValueChange,
  value
}: {
  ariaLabel: string;
  onValueChange(value: CodePreviewThemeId): void;
  value: CodePreviewThemeId;
}) {
  return (
    <Select value={value} onValueChange={(next) => onValueChange(next as CodePreviewThemeId)}>
      <SelectTrigger aria-label={ariaLabel} className="w-[220px] bg-canvas">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="item-aligned" className="rounded-xl border bg-popover p-1.5 shadow-overlay">
        {CODE_PREVIEW_THEME_OPTIONS.map((option) => (
          <SelectItem key={option.id} value={option.id} className="py-2.5 text-body-sm">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const CODE_PREVIEW_SAMPLE = `const themePreview: ThemeConfig = {
  surface: "sidebar",
  accent: "#339CFF",
  contrast: 45,
};`;

function CodeThemePreviewCard({
  active,
  badge,
  settings,
  themeId,
  title,
  variant
}: {
  active: boolean;
  badge: string;
  settings: CodePreviewSettings;
  themeId: CodePreviewThemeId;
  title: string;
  variant: "light" | "dark";
}) {
  const previewSettings = useMemo<CodePreviewSettings>(
    () => ({
      ...settings,
      lightTheme: themeId,
      darkTheme: themeId
    }),
    [settings, themeId]
  );
  const displayText = useMemo(() => normalizeCodePreviewText(CODE_PREVIEW_SAMPLE), []);
  const plainLines = useMemo(() => splitCodePreviewLines(displayText), [displayText]);
  const highlight = useShikiHighlight(displayText, "typescript", previewSettings, "SettingsView");
  const wrap = settings.wrapLongLines;

  return (
    <div className={cn("overflow-hidden rounded-md border bg-canvas", variant === "dark" && "dark")}>
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="text-body-sm font-medium text-foreground">{title}</div>
          <div className="mt-0.5 truncate text-caption text-muted-foreground">
            {codePreviewThemeLabel(themeId)}
          </div>
        </div>
        <span
          className={cn(
            "rounded-sm px-2.5 py-1 text-micro font-medium",
            active ? "bg-canvas-soft-2 text-foreground" : "bg-canvas-soft text-muted-foreground"
          )}
        >
          {badge}
        </span>
      </div>
      <div className="p-3">
        <div
          className={cn(
            "overflow-hidden rounded-md border px-3 py-2 font-mono text-[var(--cxb-code-font-size,12px)] leading-[var(--cxb-code-line-height,20px)]",
            variant === "dark"
              ? "border-transparent bg-primary text-primary-foreground"
              : "border-border bg-canvas-soft-2 text-foreground"
          )}
          data-code-font-size={settings.fontSize}
          data-code-line-numbers="true"
          data-code-wrap={wrap ? "true" : "false"}
          style={codePreviewInlineStyle(settings)}
        >
          <pre className={cn("m-0", wrap && "whitespace-pre-wrap break-all")}>
            <code>
              <CodePreviewLines
                highlightedLines={highlight.lines}
                lineNumbers={true}
                plainLines={plainLines}
                wrap={wrap}
              />
            </code>
          </pre>
        </div>
      </div>
    </div>
  );
}

function useResolvedAppearance(theme: "light" | "dark" | "system"): "light" | "dark" {
  const [resolved, setResolved] = useState<"light" | "dark">(() => resolveAppearance(theme));

  useEffect(() => {
    if (theme !== "system" || typeof window === "undefined" || typeof window.matchMedia !== "function") {
      setResolved(resolveAppearance(theme));
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => setResolved(media.matches ? "dark" : "light");
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  return resolved;
}

function resolveAppearance(theme: "light" | "dark" | "system"): "light" | "dark" {
  if (theme === "light" || theme === "dark") {
    return theme;
  }
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
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
            icon={<GlobeOutlineIcon />}
            title={t("settings.general.langZh")}
            description={t("settings.general.langZhDesc")}
            onSelect={() => setLocale("zh")}
          />
          <OptionCard
            selected={locale === "en"}
            icon={<GlobeOutlineIcon />}
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
            <FolderOpenOutlineIcon className="size-4" />
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

const CREATE_PROVIDER_CARD_ID = "create";

function providerCardId(providerId: string): string {
  return `provider:${providerId}`;
}

function ProvidersSection() {
  const { t } = useTranslation();
  const confirmDialog = useConfirmDialog();
  const providers = useAppStore(useShallow((state) => state.providers));
  const saveProvider = useAppStore((state) => state.saveProvider);
  const deleteProvider = useAppStore((state) => state.deleteProvider);
  const testProvider = useAppStore((state) => state.testProvider);

  // draft 为空 = 新建卡片里的「先选类型」阶段；选好类型或展开供应商后才渲染完整表单。
  const [draft, setDraft] = useState<ProviderInput>();
  const [errors, setErrors] = useState<ProviderDraftErrors>({});
  const [status, setStatus] = useState("");
  const [openCard, setOpenCard] = useState<string>();

  const editingProvider = draft?.id
    ? providers.find((provider) => provider.id === draft.id)
    : undefined;
  const hasStoredKey = Boolean(editingProvider?.apiKeyRef);
  const configuredProviders = providers.filter((provider) => provider.apiKeyRef);
  const createCardOpen =
    configuredProviders.length === 0 || openCard === CREATE_PROVIDER_CARD_ID;

  const resetForm = () => {
    setDraft(undefined);
    setErrors({});
    setStatus("");
    setOpenCard(undefined);
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
    setOpenCard(CREATE_PROVIDER_CARD_ID);
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
    setOpenCard(providerCardId(provider.id));
  };

  const handleCreateCardOpenChange = (open: boolean) => {
    if (!open && configuredProviders.length === 0) {
      return;
    }
    console.debug("[settings] 切换供应商卡片展开状态", {
      providerId: "new",
      name: t("settings.providers.addProvider"),
      open
    });
    if (open) {
      setDraft(undefined);
      setErrors({});
      setStatus("");
      setOpenCard(CREATE_PROVIDER_CARD_ID);
      return;
    }
    resetForm();
  };

  const handleProviderCardOpenChange = (provider: ProviderConfig, open: boolean) => {
    console.debug("[settings] 切换供应商卡片展开状态", {
      providerId: provider.id,
      name: provider.name,
      open
    });
    if (open) {
      startEdit(provider);
      return;
    }
    if (openCard === providerCardId(provider.id)) {
      resetForm();
    }
  };

  const renderProviderForm = () => (
    <div data-testid="settings-provider-form" className="p-6">
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
                setDraft(undefined);
                setOpenCard(undefined);
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
                    <ArrowTopRightIcon className="size-4" />
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
                <TrashIcon className="size-4" />
                {t("settings.providers.delete")}
              </Button>
            ) : null}
            <span className="text-caption text-muted-foreground">{status}</span>
          </div>
        </form>
      )}
    </div>
  );

  return (
    <SectionShell title={t("settings.providers.title")}>
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
          <FolderOpenOutlineIcon className="size-4" />
          {t("settings.providers.openConfigYaml")}
        </Button>
      </SettingBlock>
      <SettingBlock
        title={t("settings.providers.configuredTitle")}
        description={t("settings.providers.configuredDesc")}
      >
        <div data-testid="settings-provider-list" className="grid gap-3">
          {configuredProviders.map((provider) => {
            const open = openCard === providerCardId(provider.id);
            const subtitle =
              provider.models && provider.models.length > 1
                ? t("settings.providers.modelsSummary", { count: provider.models.length })
                : provider.model;
            return (
              <Collapsible
                key={provider.id}
                open={open}
                onOpenChange={(nextOpen) => handleProviderCardOpenChange(provider, nextOpen)}
              >
                <div
                  data-testid={`settings-provider-card-${provider.id}`}
                  className="overflow-hidden rounded-sm border bg-background"
                >
                  <div className={cn("flex items-center", open && "border-b")}>
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        aria-label={t(
                          open
                            ? "settings.providers.collapseProvider"
                            : "settings.providers.expandProvider",
                          { name: provider.name }
                        )}
                        aria-pressed={open}
                        className={cn(
                          "flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left transition-colors",
                          open ? "bg-canvas-soft-2" : "hover:bg-canvas-soft-2/70"
                        )}
                      >
                        <ChevronIcon
                          className={cn(
                            "size-4 flex-none text-muted-foreground transition-transform",
                            open && "rotate-180"
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-caption font-medium">
                            {provider.name}
                          </span>
                          <span className="block truncate text-micro text-muted-foreground">
                            {subtitle}
                          </span>
                        </span>
                      </button>
                    </CollapsibleTrigger>
                    <div className="flex flex-none items-center pr-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t("settings.providers.deleteNamed", { name: provider.name })}
                        title={t("settings.providers.delete")}
                        className="size-8 rounded-xs text-muted-foreground hover:text-destructive"
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
                        <TrashIcon className="size-4" />
                      </Button>
                    </div>
                  </div>
                  <CollapsibleContent>{open ? renderProviderForm() : null}</CollapsibleContent>
                </div>
              </Collapsible>
            );
          })}
          <Collapsible open={createCardOpen} onOpenChange={handleCreateCardOpenChange}>
            <div
              data-testid="settings-provider-create-card"
              className="overflow-hidden rounded-sm border bg-background"
            >
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  aria-label={t(
                    createCardOpen
                      ? "settings.providers.collapseAddProvider"
                      : "settings.providers.expandAddProvider"
                  )}
                  aria-pressed={createCardOpen}
                  className={cn(
                    "flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition-colors",
                    createCardOpen ? "border-b bg-canvas-soft-2" : "hover:bg-canvas-soft-2/70"
                  )}
                >
                  <ChevronIcon
                    className={cn(
                      "size-4 flex-none text-muted-foreground transition-transform",
                      createCardOpen && "rotate-180"
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-caption font-medium">
                      {t("settings.providers.addProvider")}
                    </span>
                    <span className="block truncate text-micro text-muted-foreground">
                      {configuredProviders.length === 0
                        ? t("settings.providers.required")
                        : t("settings.providers.addProviderDesc")}
                    </span>
                  </span>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                {createCardOpen ? renderProviderForm() : null}
              </CollapsibleContent>
            </div>
          </Collapsible>
        </div>
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
