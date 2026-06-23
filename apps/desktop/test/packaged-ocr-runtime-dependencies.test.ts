import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type PackageJson = {
  name?: string;
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
  return readInstalledPackage(name, fromPath).packageJson;
}

function readInstalledPackage(
  name: string,
  fromPath: string
): { packageDir: string; packageJson: PackageJson } {
  let packageDir = dirname(requireFromTest.resolve(name, { paths: [fromPath] }));
  while (true) {
    const packageJsonPath = join(packageDir, "package.json");
    if (existsSync(packageJsonPath)) {
      const packageJson = readPackageJson(packageJsonPath);
      if (packageJson.name === name) {
        return { packageDir, packageJson };
      }
    }
    const parent = dirname(packageDir);
    if (parent === packageDir) {
      throw new Error(`未找到 ${name} 的 package.json`);
    }
    packageDir = parent;
  }
}

describe("packaged OCR runtime dependencies", () => {
  const desktopPackage = readPackageJson(join(desktopDir, "package.json"));
  const { packageDir: paddlePackageDir, packageJson: paddlePackage } = readInstalledPackage(
    "ppu-paddle-ocr",
    desktopDir
  );
  const { packageDir: ocvPackageDir, packageJson: ocvPackage } = readInstalledPackage(
    "ppu-ocv",
    paddlePackageDir
  );
  const { packageDir: onnxPackageDir, packageJson: onnxPackage } = readInstalledPackage(
    "onnxruntime-node",
    desktopDir
  );

  it("declares ppu-paddle-ocr transitive runtime packages directly", () => {
    expect(paddlePackage.dependencies?.["ppu-ocv"]).toBeDefined();
    expect(desktopPackage.dependencies?.["ppu-ocv"]).toBe(ocvPackage.version);

    expect(ocvPackage.dependencies?.["@techstark/opencv-js"]).toBeDefined();
    const opencvPackage = readDependencyPackageJson("@techstark/opencv-js", ocvPackageDir);
    expect(desktopPackage.dependencies?.["@techstark/opencv-js"]).toBe(opencvPackage.version);
  });

  it("declares onnxruntime-node runtime packages directly", () => {
    expect(onnxPackage.dependencies?.["onnxruntime-common"]).toBeDefined();
    const commonPackage = readDependencyPackageJson("onnxruntime-common", onnxPackageDir);
    expect(desktopPackage.dependencies?.["onnxruntime-common"]).toBe(commonPackage.version);
  });

  it("keeps OCR native packages unpacked from app.asar", () => {
    expect(desktopPackage.build?.asarUnpack).toEqual(
      expect.arrayContaining([
        "node_modules/@napi-rs/canvas/**",
        "node_modules/@napi-rs/canvas-*/**",
        "node_modules/onnxruntime-node/**"
      ])
    );
  });
});
