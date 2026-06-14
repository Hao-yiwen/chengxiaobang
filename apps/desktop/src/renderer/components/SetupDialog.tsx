import {
  ArrowRightIcon as ArrowRight,
  ArrowSquareOutIcon as ExternalLink,
  BriefcaseIcon as Briefcase,
  CaretLeftIcon as CaretLeft,
  CheckCircleIcon as CheckCircle,
  CodeIcon as Code,
  SparkleIcon as Sparkle
} from "@phosphor-icons/react";
import { resolveProviderConfigModelOption } from "@chengxiaobang/shared";
import type { ProviderConfig, ProviderInput, ProviderKind } from "@chengxiaobang/shared";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import onboardingHeroUrl from "../../../assets/onboarding-hero.png";
import {
  defaultModelIds,
  normalizeModelIds,
  ProviderCascadeSelect,
  ProviderModelTags
} from "@/components/ProviderCascadeSelect";
import { ExternalUrlAnchor } from "@/components/ExternalUrlMenu";
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
  normalizeOnboardingProfile,
  scenariosForPrimaryUse,
  type OnboardingPrimaryUse,
  type OnboardingProfile,
  type OnboardingScenario
} from "../../common/profile";
import { API_KEY_URLS, PROVIDER_KIND_OPTIONS, PROVIDER_PRESETS } from "@/lib/provider-presets";
import { validateProviderDraft } from "@/lib/provider-validation";
import { cn } from "@/lib/utils";
import { useAppStore, type OnboardingStep } from "@/store";

type PrimaryUseTitleKey =
  | "setup.profile.primary.work.title"
  | "setup.profile.primary.code.title"
  | "setup.profile.primary.both.title";

type PrimaryUseDescKey =
  | "setup.profile.primary.work.desc"
  | "setup.profile.primary.code.desc"
  | "setup.profile.primary.both.desc";

type PrimaryUseOption = {
  id: OnboardingPrimaryUse;
  titleKey: PrimaryUseTitleKey;
  descKey: PrimaryUseDescKey;
  icon: ReactNode;
  selectedCardClassName: string;
  selectedIconClassName: string;
};

const PRIMARY_USE_OPTIONS: PrimaryUseOption[] = [
  {
    id: "work",
    titleKey: "setup.profile.primary.work.title",
    descKey: "setup.profile.primary.work.desc",
    icon: <Briefcase className="size-4" />,
    selectedCardClassName: "border-link/40 bg-link-bg-soft/45 shadow-subtle",
    selectedIconClassName: "border-link/35 bg-link/10 text-link-deep"
  },
  {
    id: "code",
    titleKey: "setup.profile.primary.code.title",
    descKey: "setup.profile.primary.code.desc",
    icon: <Code className="size-4" />,
    selectedCardClassName: "border-link/40 bg-link-bg-soft/45 shadow-subtle",
    selectedIconClassName: "border-link/35 bg-link/10 text-link-deep"
  },
  {
    id: "both",
    titleKey: "setup.profile.primary.both.title",
    descKey: "setup.profile.primary.both.desc",
    icon: <Sparkle className="size-4" />,
    selectedCardClassName: "border-link/40 bg-link-bg-soft/45 shadow-subtle",
    selectedIconClassName: "border-link/35 bg-link/10 text-link-deep"
  }
];

export function SetupDialog() {
  const { t } = useTranslation();
  const open = useAppStore((state) => state.onboardingOpen);
  const onboardingCompleted = useAppStore((state) => state.onboardingCompleted);
  const step = useAppStore((state) => state.onboardingStep);
  const profile = useAppStore((state) => state.onboardingProfile);
  const providers = useAppStore((state) => state.providers);
  const setSetupOpen = useAppStore((state) => state.setOnboardingOpen);
  const setOnboardingStep = useAppStore((state) => state.setOnboardingStep);
  const saveOnboardingProfile = useAppStore((state) => state.saveOnboardingProfile);
  const completeOnboarding = useAppStore((state) => state.completeOnboarding);
  const saveProvider = useAppStore((state) => state.saveProvider);

  const configuredProvider = useMemo(() => firstConfiguredProvider(providers), [providers]);
  const [localProfile, setLocalProfile] = useState<OnboardingProfile>(() =>
    normalizeOnboardingProfile(profile)
  );
  const [draft, setDraft] = useState<ProviderInput>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const canSave = Boolean(draft?.apiKey?.trim()) && !saving;

  function handleOpenChange(nextOpen: boolean): void {
    setSetupOpen(nextOpen);
  }

  function goToStep(nextStep: OnboardingStep): void {
    setError("");
    setOnboardingStep(nextStep);
  }

  function selectPrimaryUse(primaryUse: OnboardingPrimaryUse): void {
    setLocalProfile((current) => {
      const availableScenarios = scenariosForPrimaryUse(primaryUse);
      return {
        primaryUse,
        scenarios: current.scenarios.filter((scenario) => availableScenarios.includes(scenario))
      };
    });
  }

  function toggleScenario(id: OnboardingScenario): void {
    setLocalProfile((current) => {
      const exists = current.scenarios.includes(id);
      return {
        ...current,
        scenarios: exists
          ? current.scenarios.filter((item) => item !== id)
          : [...current.scenarios, id]
      };
    });
  }

  function continueFromProfile(): void {
    saveOnboardingProfile(localProfile);
    goToStep("model");
  }

  function finishWithExistingProvider(): void {
    if (!configuredProvider) {
      return;
    }
    console.info("[setup] 使用现有模型完成首启引导", {
      providerId: configuredProvider.id,
      providerKind: configuredProvider.kind,
      model: configuredProvider.model
    });
    completeOnboarding();
  }

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!draft) {
      setError(t("settings.providers.errors.provider"));
      return;
    }
    if (!canSave) {
      return;
    }
    const validation = validateProviderDraft(draft, { hasStoredKey: false });
    const firstError = Object.values(validation).find(Boolean);
    if (firstError) {
      console.warn("[setup] 首启模型配置校验未通过", {
        validation,
        providerKind: draft.kind
      });
      setError(t(firstError));
      return;
    }
    setSaving(true);
    setError("");
    try {
      await saveProvider(draft);
      console.info("[setup] 首启模型配置保存成功", {
        providerKind: draft.kind,
        model: draft.model,
        modelCount: draft.models?.length ?? 0
      });
      completeOnboarding();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error("[setup] 首启模型配置保存失败", {
        providerKind: draft.kind,
        model: draft.model,
        error: message
      });
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="h-[calc(100vh-72px)] max-w-[860px] overflow-hidden p-0 sm:h-[550px] sm:max-h-[calc(100vh-72px)] sm:rounded-xl">
        <div className="grid h-full min-h-0 grid-rows-[220px_minmax(0,1fr)] overflow-hidden bg-card md:grid-rows-none md:grid-cols-[minmax(0,0.86fr)_minmax(380px,1fr)]">
          <aside className="relative min-h-0 overflow-hidden border-b border-border bg-canvas-soft md:border-b-0 md:border-r">
            <img
              src={onboardingHeroUrl}
              alt={t("setup.welcome.imageAlt")}
              className="absolute inset-0 h-full w-full object-cover object-left"
            />
          </aside>

          <section className="flex min-h-0 flex-col overflow-y-auto p-5 sm:p-6">
            {step === "welcome" ? (
              <WelcomeStep onNext={() => goToStep("profile")} />
            ) : step === "profile" ? (
              <ProfileStep
                profile={localProfile}
                onPrimaryUseChange={selectPrimaryUse}
                onToggleScenario={toggleScenario}
                onBack={() => goToStep("welcome")}
                onNext={continueFromProfile}
              />
            ) : (
              <ModelStep
                draft={draft}
                error={error}
                configuredProvider={configuredProvider}
                onboardingCompleted={onboardingCompleted}
                saving={saving}
                canSave={canSave}
                onDraftChange={(nextDraft) => {
                  setDraft(nextDraft);
                  setError("");
                }}
                onBack={() => goToStep("profile")}
                onClose={() => setSetupOpen(false)}
                onUseExisting={finishWithExistingProvider}
                onSubmit={onSubmit}
              />
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WelcomeStep(props: { onNext: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col justify-center">
      <DialogHeader className="items-start text-left sm:text-left">
        <span className="mb-4 inline-flex w-fit items-center rounded-pill border border-border bg-canvas-soft-2 px-3 py-1 text-caption text-muted-foreground">
          {t("setup.welcome.badge")}
        </span>
        <DialogTitle className="max-w-[25rem] text-display-md leading-tight">
          {t("setup.welcome.title")}
        </DialogTitle>
        <DialogDescription className="max-w-[25rem] pt-2 text-body-sm leading-relaxed">
          {t("setup.welcome.desc")}
        </DialogDescription>
      </DialogHeader>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Button
          type="button"
          size="lg"
          className="bg-link px-6 text-primary-foreground shadow-subtle hover:bg-link-deep"
          onClick={props.onNext}
        >
          {t("setup.welcome.start")}
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function ProfileStep(props: {
  profile: OnboardingProfile;
  onPrimaryUseChange: (primaryUse: OnboardingPrimaryUse) => void;
  onToggleScenario: (id: OnboardingScenario) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const scenarioOptions = scenariosForPrimaryUse(props.profile.primaryUse);
  return (
    <div className="flex h-full flex-col">
      <DialogHeader className="items-start text-left sm:text-left">
        <DialogTitle className="text-display-sm">{t("setup.profile.title")}</DialogTitle>
        <DialogDescription className="max-w-[31rem] pt-1 text-body-sm leading-relaxed">
          {t("setup.profile.desc")}
        </DialogDescription>
      </DialogHeader>

      <div className="mt-6 grid gap-5">
        <section className="grid gap-2">
          <Label className="text-micro text-muted-slate">{t("setup.profile.primaryLabel")}</Label>
          <div className="grid gap-2">
            {PRIMARY_USE_OPTIONS.map((option) => {
              const selected = props.profile.primaryUse === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-label={t(option.titleKey)}
                  aria-pressed={selected}
                  className={cn(
                    "flex min-h-[66px] items-start gap-3 rounded-md border bg-card p-2.5 text-left transition-colors",
                    selected ? option.selectedCardClassName : "border-border hover:bg-canvas-soft-2"
                  )}
                  onClick={() => props.onPrimaryUseChange(option.id)}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-8 flex-none items-center justify-center rounded-sm border",
                      selected ? option.selectedIconClassName : "border-border bg-canvas text-muted-foreground"
                    )}
                  >
                    {option.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-body-sm font-medium text-foreground">
                      {t(option.titleKey)}
                    </span>
                    <span className="mt-0.5 block text-caption leading-snug text-muted-foreground">
                      {t(option.descKey)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="grid gap-2">
          <Label className="text-micro text-muted-slate">{t("setup.profile.scenarioLabel")}</Label>
          <div className="flex flex-wrap gap-2">
            {scenarioOptions.map((id) => {
              const selected = props.profile.scenarios.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={selected}
                  className={cn(
                    "rounded-pill border px-3 py-1.5 text-caption transition-colors",
                    selected
                      ? "border-link/45 bg-link-bg-soft text-link-deep"
                      : "border-border bg-canvas text-foreground hover:bg-canvas-soft-2"
                  )}
                  onClick={() => props.onToggleScenario(id)}
                >
                  {t(`setup.profile.scenarios.${id}`)}
                </button>
              );
            })}
          </div>
        </section>
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 pt-8">
        <Button type="button" variant="ghost" size="sm" onClick={props.onBack}>
          <CaretLeft className="size-4" />
          {t("setup.back")}
        </Button>
        <Button
          type="button"
          size="sm"
          className="bg-link px-4 text-primary-foreground hover:bg-link-deep"
          onClick={props.onNext}
        >
          {t("setup.next")}
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function ModelStep(props: {
  draft: ProviderInput | undefined;
  error: string;
  configuredProvider: ProviderConfig | undefined;
  onboardingCompleted: boolean;
  saving: boolean;
  canSave: boolean;
  onDraftChange: (draft: ProviderInput) => void;
  onBack: () => void;
  onClose: () => void;
  onUseExisting: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const { t } = useTranslation();
  const draft = props.draft;

  return (
    <form className="flex h-full flex-col" onSubmit={props.onSubmit}>
      <DialogHeader className="items-start text-left sm:text-left">
        <DialogTitle className="text-display-sm">{t("setup.title")}</DialogTitle>
        <DialogDescription className="max-w-[31rem] pt-1 text-body-sm leading-relaxed">
          {props.configuredProvider ? t("setup.model.existingDesc") : t("setup.desc")}
        </DialogDescription>
      </DialogHeader>

      {props.configuredProvider ? (
        <div
          data-testid="onboarding-current-model"
          className="mt-5 flex items-start gap-3 rounded-md border border-border bg-canvas-soft p-3"
        >
          <span className="flex size-8 flex-none items-center justify-center rounded-sm bg-primary text-primary-foreground">
            <CheckCircle className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-body-sm font-medium text-foreground">
              {t("setup.model.currentModel")}
            </div>
            <div className="mt-1 truncate text-caption text-muted-foreground">
              {providerSummary(props.configuredProvider)}
            </div>
          </div>
          <Button type="button" size="sm" className="flex-none px-3" onClick={props.onUseExisting}>
            {t("setup.model.useExisting")}
          </Button>
        </div>
      ) : null}

      <div className="mt-5 grid gap-3.5">
        <div className="grid gap-1.5">
          <Label className="text-micro text-muted-slate">
            {t("settings.providers.type")}
          </Label>
          <ProviderCascadeSelect
            value={draft?.kind}
            ariaLabel={t("settings.providers.type")}
            options={PROVIDER_KIND_OPTIONS}
            placeholder={t("settings.providers.cascadePlaceholder")}
            selectedModelIds={draft?.models}
            onSelectedModelIdsChange={(modelIds) => {
              if (!draft) {
                return;
              }
              props.onDraftChange(applyDraftModels(draft, modelIds));
            }}
            onValueChange={(kind, modelIds) => {
              console.debug("[setup] 首启配置切换供应商", { kind });
              props.onDraftChange(
                providerDraftFromPreset(kind, { apiKey: draft?.apiKey ?? "", modelIds })
              );
            }}
          />
        </div>

        {draft ? (
          <>
            <div className="grid gap-1.5">
              <Label className="text-micro text-muted-slate">
                {t("settings.providers.selectedModels")}
              </Label>
              <ProviderModelTags
                providerKind={draft.kind}
                modelIds={draft.models}
                emptyLabel={t("settings.providers.noModelsSelected")}
                onRemove={(modelId) => {
                  props.onDraftChange(
                    applyDraftModels(
                      draft,
                      (draft.models ?? []).filter((id) => id !== modelId)
                    )
                  );
                }}
              />
            </div>

            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-micro text-muted-slate">API Key</Label>
                {API_KEY_URLS[draft.kind] ? (
                  <ExternalUrlAnchor
                    href={API_KEY_URLS[draft.kind]!}
                    className="flex items-center gap-1 text-micro text-link underline-offset-2 hover:underline"
                  >
                    <ExternalLink className="size-3" />
                    {t("settings.providers.getApiKey")}
                  </ExternalUrlAnchor>
                ) : null}
              </div>
              <Input
                autoFocus
                type="password"
                placeholder={t("setup.apiKeyPlaceholder")}
                value={draft.apiKey ?? ""}
                onChange={(event) => props.onDraftChange({ ...draft, apiKey: event.target.value })}
              />
            </div>

            <div className="grid gap-1.5">
              <Label className="text-micro text-muted-slate">Base URL</Label>
              <Input
                value={draft.baseURL}
                onChange={(event) => props.onDraftChange({ ...draft, baseURL: event.target.value })}
              />
            </div>
          </>
        ) : null}

        {props.error ? <p className="text-micro text-destructive">{props.error}</p> : null}
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 pt-8">
        {props.onboardingCompleted ? (
          <Button type="button" variant="ghost" size="sm" onClick={props.onClose}>
            {t("setup.later")}
          </Button>
        ) : (
          <Button type="button" variant="ghost" size="sm" onClick={props.onBack}>
            <CaretLeft className="size-4" />
            {t("setup.back")}
          </Button>
        )}
        <Button
          type="submit"
          size="sm"
          className="bg-link px-4 text-primary-foreground hover:bg-link-deep"
          disabled={!props.canSave}
        >
          {props.saving ? t("setup.saving") : t("setup.save")}
        </Button>
      </div>
    </form>
  );
}

function firstConfiguredProvider(providers: ProviderConfig[]): ProviderConfig | undefined {
  return providers.find((provider) => Boolean(provider.apiKeyRef));
}

function providerSummary(provider: ProviderConfig): string {
  const option = resolveProviderConfigModelOption(provider, provider.model);
  return `${provider.name} · ${option.label ?? provider.model}`;
}

function providerDraftFromPreset(
  kind: ProviderKind,
  options: { apiKey?: string; modelIds?: string[] } = {}
): ProviderInput {
  const preset = PROVIDER_PRESETS[kind];
  const models = normalizeModelIds(kind, options.modelIds ?? preset.models ?? defaultModelIds(kind));
  return {
    ...preset,
    apiKey: options.apiKey,
    models,
    model: models.includes(preset.model) ? preset.model : models[0] ?? preset.model
  };
}

function applyDraftModels(draft: ProviderInput, modelIds: string[]): ProviderInput {
  const models = normalizeModelIds(draft.kind, modelIds, { allowEmpty: true });
  return {
    ...draft,
    models,
    model: models.includes(draft.model) ? draft.model : models[0] ?? draft.model
  };
}
