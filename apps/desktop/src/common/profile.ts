export const ONBOARDING_PRIMARY_USES = ["work", "code", "both"] as const;
export type OnboardingPrimaryUse = (typeof ONBOARDING_PRIMARY_USES)[number];

export const ONBOARDING_SCENARIOS = [
  "docs",
  "research",
  "automation",
  "frontend",
  "backend",
  "debugging",
  "data"
] as const;
export type OnboardingScenario = (typeof ONBOARDING_SCENARIOS)[number];

export type OnboardingProfile = {
  primaryUse: OnboardingPrimaryUse;
  scenarios: OnboardingScenario[];
};

export type UserProfileJson = {
  version: 1;
  updatedAt: string;
  onboardingProfile: OnboardingProfile;
} & Record<string, unknown>;

export const SCENARIOS_BY_PRIMARY_USE: Record<OnboardingPrimaryUse, OnboardingScenario[]> = {
  work: ["docs", "research", "automation", "data"],
  code: ["frontend", "backend", "debugging", "data"],
  both: [...ONBOARDING_SCENARIOS]
};

const primaryUseSet = new Set<string>(ONBOARDING_PRIMARY_USES);
const scenarioSet = new Set<string>(ONBOARDING_SCENARIOS);

export function normalizeOnboardingProfile(input: unknown): OnboardingProfile {
  const record = isRecord(input) ? input : {};
  const primaryUse = primaryUseSet.has(String(record.primaryUse))
    ? (record.primaryUse as OnboardingPrimaryUse)
    : "both";
  const allowedScenarios = SCENARIOS_BY_PRIMARY_USE[primaryUse];
  const scenarios = Array.isArray(record.scenarios)
    ? uniqueScenarios(record.scenarios)
    : [];
  return {
    primaryUse,
    scenarios: scenarios.filter((scenario) => allowedScenarios.includes(scenario))
  };
}

export function scenariosForPrimaryUse(primaryUse: OnboardingPrimaryUse): OnboardingScenario[] {
  return [...SCENARIOS_BY_PRIMARY_USE[primaryUse]];
}

function uniqueScenarios(items: unknown[]): OnboardingScenario[] {
  const result: OnboardingScenario[] = [];
  for (const item of items) {
    if (!scenarioSet.has(String(item))) {
      continue;
    }
    const scenario = item as OnboardingScenario;
    if (!result.includes(scenario)) {
      result.push(scenario);
    }
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
