import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  normalizeOnboardingProfile,
  type OnboardingProfile,
  type UserProfileJson
} from "../common/profile";

export type SaveUserProfileResult =
  | { ok: true; path: string; profile: UserProfileJson }
  | { ok: false; path: string; error: string };

export async function saveUserProfile(
  input: unknown,
  options: { profilePath: string; now?: Date }
): Promise<SaveUserProfileResult> {
  const profilePath = options.profilePath;
  try {
    const onboardingProfile = readOnboardingProfileInput(input);
    const existing = await readExistingProfile(profilePath);
    const nextProfile: UserProfileJson = {
      ...existing,
      version: 1,
      updatedAt: (options.now ?? new Date()).toISOString(),
      onboardingProfile
    };
    await mkdir(dirname(profilePath), { recursive: true });
    await writeFile(profilePath, `${JSON.stringify(nextProfile, null, 2)}\n`, "utf8");
    return { ok: true, path: profilePath, profile: nextProfile };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, path: profilePath, error: message };
  }
}

function readOnboardingProfileInput(input: unknown): OnboardingProfile {
  if (isRecord(input) && isRecord(input.onboardingProfile)) {
    return normalizeOnboardingProfile(input.onboardingProfile);
  }
  return normalizeOnboardingProfile(input);
}

async function readExistingProfile(profilePath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(profilePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
