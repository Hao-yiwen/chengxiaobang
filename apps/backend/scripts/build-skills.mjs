import { existsSync } from "node:fs";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = dirname(here);

// 内置技能与市场技能都随 dist 分发；市场技能默认不激活，由技能市场按需启用。
for (const dirName of ["skills", "skills-market"]) {
  const source = join(packageRoot, dirName);
  const target = join(packageRoot, "dist", dirName);
  if (!existsSync(source)) {
    continue;
  }
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await copyNonTypeScriptAssets(source, target);
  await bundleRunnableScripts(source, target, source);
  console.log(`[chengxiaobang] built ${dirName} -> ${target}`);
}

async function copyNonTypeScriptAssets(from, to) {
  const entries = await readdir(from, { withFileTypes: true });
  await mkdir(to, { recursive: true });
  for (const entry of entries) {
    const sourcePath = join(from, entry.name);
    const targetPath = join(to, entry.name);
    if (entry.isDirectory()) {
      await copyNonTypeScriptAssets(sourcePath, targetPath);
      continue;
    }
    if (extname(entry.name) === ".ts") {
      continue;
    }
    await cp(sourcePath, targetPath);
  }
}

async function bundleRunnableScripts(from, toRoot, sourceRoot) {
  const entries = await readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = join(from, entry.name);
    if (entry.isDirectory()) {
      await bundleRunnableScripts(sourcePath, toRoot, sourceRoot);
      continue;
    }
    if (!isRunnableSkillScript(sourcePath, sourceRoot)) {
      continue;
    }
    const relativePath = relative(sourceRoot, sourcePath).replace(/\.ts$/, ".mjs");
    const outputPath = join(toRoot, relativePath);
    await mkdir(dirname(outputPath), { recursive: true });
    await runEsbuild(sourcePath, outputPath);
  }
}

function isRunnableSkillScript(file, sourceRoot) {
  const parentParts = relative(sourceRoot, dirname(file)).split(/[\\/]/);
  return parentParts.at(-1) === "scripts" && /\.(?:mjs|js|ts)$/.test(file);
}

async function runEsbuild(entry, outfile) {
  const banner = [
    "import { createRequire as __cxbCreateRequire } from 'node:module';",
    "import { fileURLToPath as __cxbFileURLToPath } from 'node:url';",
    "import { dirname as __cxbDirname } from 'node:path';",
    "const require = __cxbCreateRequire(import.meta.url);",
    "const __filename = __cxbFileURLToPath(import.meta.url);",
    "const __dirname = __cxbDirname(__filename);"
  ].join("\n");
  try {
    await build({
      entryPoints: [entry],
      bundle: true,
      platform: "node",
      format: "esm",
      target: "es2022",
      logLevel: "warning",
      banner: { js: banner },
      outfile
    });
  } catch (error) {
    const detail = formatBuildError(error);
    throw new Error(`技能脚本打包失败: ${entry}\n${detail}`);
  }
}

function formatBuildError(error) {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const detail = [error.message, formatEsbuildMessages(error.errors), formatEsbuildMessages(error.warnings)]
    .filter(Boolean)
    .join("\n");
  return detail || error.stack || error.name;
}

function formatEsbuildMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return "";
  }
  return messages
    .map((message) => {
      const location = message.location
        ? `${message.location.file}:${message.location.line}:${message.location.column}`
        : "";
      return [location, message.text].filter(Boolean).join(" ");
    })
    .join("\n");
}
