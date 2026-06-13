import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(desktopDir, "../..");
const runtimeDir = resolve(desktopDir, "build/runtime");
const bunBinDir = resolve(repoRoot, "node_modules/bun/bin");
const sourceNames = process.platform === "win32" ? ["bun.exe", "bun"] : ["bun", "bun.exe"];
const source = sourceNames.map((name) => resolve(bunBinDir, name)).find((path) => existsSync(path));
const platformDirName =
  process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : process.platform;
const targetName = process.platform === "win32" ? "bun.exe" : "bun";
const targetDir = resolve(runtimeDir, platformDirName);
const target = resolve(targetDir, targetName);

async function main() {
  if (!source) {
    throw new Error(
      `未找到 Bun 运行时，请先执行 pnpm install。已检查: ${sourceNames
        .map((name) => resolve(bunBinDir, name))
        .join(", ")}`
    );
  }
  const sourceStat = await stat(source);
  if (!sourceStat.isFile()) {
    throw new Error(`Bun 运行时不是可复制文件: ${source}`);
  }

  await rm(runtimeDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  await copyFile(source, target);
  console.info(
    `[build] 已准备 ${process.platform}/${process.arch} Bun 运行时 source=${source} target=${target} size=${sourceStat.size}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
