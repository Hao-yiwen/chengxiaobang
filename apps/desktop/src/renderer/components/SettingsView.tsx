import {
  ArrowLeft,
  Boxes,
  ExternalLink,
  FolderOpen,
  Globe,
  Languages,
  Laptop,
  LockKeyhole,
  MessageSquareText,
  Moon,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  SunMoon,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ProviderInput } from "@chengxiaobang/shared";
import { useShallow } from "zustand/react/shallow";
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
import { FeishuSection } from "@/components/settings/FeishuSection";
import { OptionCard } from "@/components/settings/OptionCard";
import { SectionShell, SettingBlock } from "@/components/settings/SectionShell";
import { API_KEY_URLS, PROVIDER_KIND_OPTIONS, PROVIDER_PRESETS } from "@/lib/provider-presets";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

type SectionId = "appearance" | "general" | "providers" | "skills" | "feishu";

interface NavDef {
  id: SectionId;
  labelKey:
    | "settings.nav.appearance"
    | "settings.nav.general"
    | "settings.nav.providers"
    | "settings.nav.skills"
    | "settings.nav.feishu";
  icon: typeof Sun;
  groupKey: "settings.groupPersonal" | "settings.groupModel" | "settings.groupIntegrations";
}

interface NavItem {
  id: SectionId;
  label: string;
  icon: typeof Sun;
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
    <div className="grid h-screen min-h-0 min-w-0 flex-1 grid-cols-[232px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-hidden bg-background">
      {/* Settings nav */}
      <aside className="flex h-full min-h-0 flex-col gap-1 overflow-y-auto border-r border-border/70 bg-surface px-3 pb-4">
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
            <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
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
                    "group flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                    section === item.id
                      ? "bg-accent font-medium text-accent-foreground"
                      : "text-foreground hover:bg-accent/60"
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
          <p className="px-2.5 py-2 text-sm text-muted-foreground">{t("settings.noResults")}</p>
        ) : null}
      </aside>

      {/* Content — occupies the main column, styled like the chat surface card */}
      <div className="m-2 ml-0 h-[calc(100vh-1rem)] min-h-0 overflow-y-auto rounded-xl border bg-background px-12 pb-16 pt-16 shadow-soft max-[840px]:m-0 max-[840px]:h-screen max-[840px]:rounded-none max-[840px]:border-0">
        <div className="mx-auto max-w-[760px]">
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

const EMPTY_DRAFT: ProviderInput = { ...PROVIDER_PRESETS.deepseek, apiKey: "" };

function ProvidersSection() {
  const { t } = useTranslation();
  const providers = useAppStore(useShallow((state) => state.providers));
  const saveProvider = useAppStore((state) => state.saveProvider);
  const deleteProvider = useAppStore((state) => state.deleteProvider);
  const testProvider = useAppStore((state) => state.testProvider);

  const [draft, setDraft] = useState<ProviderInput>(EMPTY_DRAFT);
  const [status, setStatus] = useState("");

  return (
    <SectionShell title={t("settings.providers.title")}>
      {providers.every((provider) => !provider.apiKeyRef) ? (
        <div className="rounded-xl border bg-muted/60 px-4 py-3 text-sm text-foreground">
          {t("settings.providers.required")}
        </div>
      ) : null}
      <SettingBlock
        title={t("settings.providers.configuredTitle")}
        description={t("settings.providers.configuredDesc")}
      >
        <Card className="divide-y p-1.5">
          {providers.length === 0 ? (
            <div className="px-3 py-4 text-sm text-muted-foreground">
              {t("settings.providers.empty")}
            </div>
          ) : (
            providers.map((provider) => (
              <button
                key={provider.id}
                type="button"
                onClick={() => {
                  setDraft({
                    id: provider.id,
                    kind: provider.kind,
                    name: provider.name,
                    baseURL: provider.baseURL,
                    model: provider.model,
                    apiKey: ""
                  });
                  setStatus("");
                }}
                className="flex w-full flex-col gap-0.5 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-accent/60"
              >
                <span className="text-sm font-medium">{provider.name}</span>
                <span className="text-[13px] text-muted-foreground">{provider.model}</span>
              </button>
            ))
          )}
        </Card>
      </SettingBlock>

      <SettingBlock
        title={draft.id ? t("settings.providers.edit") : t("settings.providers.create")}
      >
        <Card className="p-6">
          <form
            className="grid gap-4"
            onSubmit={async (event) => {
              event.preventDefault();
              await saveProvider(draft);
              setStatus(t("settings.providers.saved"));
            }}
          >
            <Field label={t("settings.providers.type")}>
              <Select
                value={draft.kind}
                onValueChange={(value) => {
                  const kind = value as ProviderInput["kind"];
                  setDraft({ ...PROVIDER_PRESETS[kind], id: draft.id, apiKey: draft.apiKey });
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
            <Field label={t("settings.providers.name")}>
              <Input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </Field>
            <Field label="Base URL">
              <Input
                value={draft.baseURL}
                onChange={(event) => setDraft({ ...draft, baseURL: event.target.value })}
              />
            </Field>
            <Field label={t("settings.providers.model")}>
              <Input
                value={draft.model}
                onChange={(event) => setDraft({ ...draft, model: event.target.value })}
              />
            </Field>
            <Field label="API Key">
              <div className="flex gap-2">
                <Input
                  type="password"
                  value={draft.apiKey ?? ""}
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
                    await testProvider(draft.id!);
                    setStatus(t("settings.providers.connectionOk"));
                  }}
                >
                  {t("settings.providers.test")}
                </Button>
              ) : null}
              {draft.id ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setDraft(EMPTY_DRAFT);
                    setStatus("");
                  }}
                >
                  {t("settings.providers.new")}
                </Button>
              ) : null}
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
                    setDraft(EMPTY_DRAFT);
                    setStatus(t("settings.providers.deleted"));
                  }}
                >
                  <Trash2 className="size-4" />
                  {t("settings.providers.delete")}
                </Button>
              ) : null}
              <span className="text-sm text-muted-foreground">{status}</span>
            </div>
          </form>
        </Card>
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
        <Card className="divide-y p-1.5">
          {slashCommands.length === 0 ? (
            <div className="px-3 py-4 text-sm text-muted-foreground">
              {t("settings.skills.empty")}
            </div>
          ) : (
            slashCommands.map((command) => (
              <div key={command.id} className="flex items-start gap-3 px-3 py-2.5">
                <span className="mt-0.5 rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] text-foreground">
                  {command.name}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-muted-foreground">
                    {command.description || t("composer.slashNoDescription")}
                  </div>
                </div>
                <span className="flex-none text-[11px] text-muted-foreground/70">
                  {sourceLabel[command.source] ?? command.source}
                </span>
              </div>
            ))
          )}
        </Card>
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

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label className="text-muted-foreground">{props.label}</Label>
      {props.children}
    </div>
  );
}
