import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { saveUserProfile } from "../src/main/profile";

describe("saveUserProfile", () => {
  it("writes onboardingProfile into profile.json and keeps existing fields", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cxb-profile-"));
    const profilePath = join(dir, "profile.json");
    await writeFile(profilePath, JSON.stringify({ nickname: "程小帮" }), "utf8");

    const result = await saveUserProfile(
      {
        primaryUse: "code",
        scenarios: ["frontend", "backend", "frontend", "unknown"]
      },
      { profilePath, now: new Date("2026-06-14T00:00:00.000Z") }
    );

    expect(result.ok).toBe(true);
    const raw = await readFile(profilePath, "utf8");
    expect(JSON.parse(raw)).toEqual({
      nickname: "程小帮",
      version: 1,
      updatedAt: "2026-06-14T00:00:00.000Z",
      onboardingProfile: {
        primaryUse: "code",
        scenarios: ["frontend", "backend"]
      }
    });
  });

  it("keeps scenarios empty when the user has not selected any tag", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cxb-profile-"));
    const profilePath = join(dir, "profile.json");

    const result = await saveUserProfile(
      { primaryUse: "work", scenarios: [] },
      { profilePath, now: new Date("2026-06-14T00:00:00.000Z") }
    );

    expect(result).toMatchObject({
      ok: true,
      profile: {
        onboardingProfile: {
          primaryUse: "work",
          scenarios: []
        }
      }
    });
  });
});
