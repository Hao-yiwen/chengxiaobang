import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveWorkspaceBin } from "../scripts/dev-bin.mjs";

describe("resolveWorkspaceBin", () => {
  const repoRoot = "/repo";
  const desktopDir = "/repo/apps/desktop";

  it("prefers the desktop workspace bin when it exists", () => {
    const desktopElectron = resolve(desktopDir, "node_modules/.bin/electron");
    const rootElectron = resolve(repoRoot, "node_modules/.bin/electron");
    const existing = new Set([desktopElectron, rootElectron]);

    const bin = resolveWorkspaceBin("electron", {
      desktopDir,
      repoRoot,
      platform: "darwin",
      existsSyncImpl: (candidate) => existing.has(candidate)
    });

    expect(bin).toBe(desktopElectron);
  });

  it("falls back to the root workspace bin for shared dev tools", () => {
    const rootTsup = resolve(repoRoot, "node_modules/.bin/tsup");
    const existing = new Set([rootTsup]);

    const bin = resolveWorkspaceBin("tsup", {
      desktopDir,
      repoRoot,
      platform: "darwin",
      existsSyncImpl: (candidate) => existing.has(candidate)
    });

    expect(bin).toBe(rootTsup);
  });

  it("uses Windows command shims before extensionless bins", () => {
    const desktopElectronCmd = resolve(desktopDir, "node_modules/.bin/electron.cmd");
    const existing = new Set([desktopElectronCmd]);

    const bin = resolveWorkspaceBin("electron", {
      desktopDir,
      repoRoot,
      platform: "win32",
      existsSyncImpl: (candidate) => existing.has(candidate)
    });

    expect(bin).toBe(desktopElectronCmd);
  });
});
