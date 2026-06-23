import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type PackageJson = {
  version?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  build?: {
    asarUnpack?: string[];
  };
};

const requireFromTest = createRequire(import.meta.url);
const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readPackageJson(path: string): PackageJson {
  return JSON.parse(readFileSync(path, "utf8")) as PackageJson;
}

function readDependencyPackageJson(name: string, fromPath: string): PackageJson {
  return readPackageJson(requireFromTest.resolve(`${name}/package.json`, { paths: [fromPath] }));
}

describe("packaged sharp dependencies", () => {
  const desktopPackage = readPackageJson(join(desktopDir, "package.json"));
  const sharpPackagePath = requireFromTest.resolve("sharp/package.json", { paths: [desktopDir] });
  const sharpPackageDir = dirname(sharpPackagePath);
  const sharpPackage = readPackageJson(sharpPackagePath);

  it("declares sharp runtime dependencies directly for Electron packaging", () => {
    for (const name of ["detect-libc", "@img/colour"]) {
      expect(sharpPackage.dependencies?.[name]).toBeDefined();
      const dependencyPackage = readDependencyPackageJson(name, sharpPackageDir);
      expect(desktopPackage.dependencies?.[name]).toBe(dependencyPackage.version);
    }
  });

  it("declares supported sharp native packages for packaged macOS and Windows builds", () => {
    const supportedNativePackages = [
      "@img/sharp-darwin-arm64",
      "@img/sharp-darwin-x64",
      "@img/sharp-libvips-darwin-arm64",
      "@img/sharp-libvips-darwin-x64",
      "@img/sharp-win32-x64"
    ];

    for (const name of supportedNativePackages) {
      expect(desktopPackage.optionalDependencies?.[name]).toBe(
        sharpPackage.optionalDependencies?.[name]
      );
    }
  });

  it("keeps sharp native packages unpacked from app.asar", () => {
    expect(desktopPackage.build?.asarUnpack).toEqual(
      expect.arrayContaining(["node_modules/sharp/**", "node_modules/@img/**"])
    );
  });
});
