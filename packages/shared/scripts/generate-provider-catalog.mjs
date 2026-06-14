#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, "..");
const yamlPath = resolve(packageRoot, "provider-catalog.yaml");
const outputPath = resolve(packageRoot, "src/provider-catalog.generated.ts");
const maxConfigurableToolIterations = 5000;

const yaml = await loadYaml();
const mode = process.argv.includes("--check") ? "check" : "write";
const source = await readFile(yamlPath, "utf8");
const catalog = normalizeCatalog(yaml.load(source));
const generated = renderCatalog(catalog);

if (mode === "check") {
  let current = "";
  try {
    current = await readFile(outputPath, "utf8");
  } catch {
    console.error("[provider-catalog] generated 文件不存在，请运行 pnpm --filter @chengxiaobang/shared catalog:generate");
    process.exit(1);
  }
  if (current !== generated) {
    console.error("[provider-catalog] provider-catalog.generated.ts 已过期，请运行 pnpm --filter @chengxiaobang/shared catalog:generate");
    process.exit(1);
  }
  console.info("[provider-catalog] generated 文件已是最新");
} else {
  await writeFile(outputPath, generated);
  console.info(`[provider-catalog] 已生成 ${outputPath}`);
}

async function loadYaml() {
  const require = createRequire(import.meta.url);
  try {
    return require("js-yaml");
  } catch {
    const fallback = resolve(
      packageRoot,
      "../../node_modules/.pnpm/js-yaml@4.1.0/node_modules/js-yaml/index.js"
    );
    return import(pathToFileURL(fallback).href);
  }
}

function normalizeCatalog(value) {
  if (!isRecord(value) || !isRecord(value.providers)) {
    throw new Error("provider-catalog.yaml 必须包含 providers 对象");
  }
  const providers = Object.entries(value.providers).map(([kind, raw]) =>
    normalizeProvider(kind, raw)
  );
  if (providers.length === 0) {
    throw new Error("provider-catalog.yaml 至少需要一个 provider");
  }
  return {
    settings: {
      runtimeDefaults: normalizeRuntimeDefaults(value.runtimeDefaults),
      currency: normalizeCurrencySettings(value.currency)
    },
    providers
  };
}

function normalizeRuntimeDefaults(value) {
  if (!isRecord(value)) {
    throw new Error("provider-catalog.yaml 必须包含 runtimeDefaults 对象");
  }
  return {
    maxToolIterations: requiredConfigurablePositiveInt(
      value.maxToolIterations,
      "runtimeDefaults.maxToolIterations"
    ),
    autoCompactThresholdRatio: requiredRatio(
      value.autoCompactThresholdRatio,
      "runtimeDefaults.autoCompactThresholdRatio"
    )
  };
}

function normalizeCurrencySettings(value) {
  if (!isRecord(value)) {
    throw new Error("provider-catalog.yaml 必须包含 currency 对象");
  }
  return {
    usdToCnyExchangeRate: requiredPositiveNumber(
      value.usdToCnyExchangeRate,
      "currency.usdToCnyExchangeRate"
    )
  };
}

function normalizeProvider(kind, value) {
  if (!isRecord(value)) {
    throw new Error(`provider ${kind} 必须是对象`);
  }
  const provider = {
    kind,
    label: requiredString(value.label, `${kind}.label`),
    name: requiredString(value.name, `${kind}.name`),
    region: requiredOneOf(value.region, `${kind}.region`, ["cn", "global", "gateway", "custom"]),
    api: requiredOneOf(value.api ?? "openai-completions", `${kind}.api`, [
      "openai-completions",
      "openai-responses",
      "anthropic-messages",
      "google-generative-ai"
    ]),
    auth: normalizeAuth(value.auth, `${kind}.auth`),
    defaultBaseURL: requiredString(value.defaultBaseURL, `${kind}.defaultBaseURL`),
    defaultModel: requiredString(value.defaultModel ?? "", `${kind}.defaultModel`),
    builtinDefault: value.builtinDefault === true,
    ...(typeof value.apiKeyUrl === "string" ? { apiKeyUrl: value.apiKeyUrl } : {}),
    ...(typeof value.piProviderSlug === "string" ? { piProviderSlug: value.piProviderSlug } : {}),
    models: asArray(value.models, `${kind}.models`).map((model) =>
      normalizeModel(model, `${kind}.models`)
    ),
    modelFallbacks: asArray(value.modelFallbacks, `${kind}.modelFallbacks`).map((fallback) =>
      normalizeFallback(fallback, `${kind}.modelFallbacks`)
    )
  };
  for (const fallback of provider.modelFallbacks) {
    try {
      new RegExp(fallback.pattern);
    } catch (error) {
      throw new Error(
        `${kind}.modelFallbacks pattern 非法: ${fallback.pattern} ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
  if (provider.models.length > 0 && !provider.models.some((model) => model.enabled !== false)) {
    throw new Error(`${kind}.models 至少需要一个默认启用模型`);
  }
  return provider;
}

function normalizeModel(value, path) {
  const model = normalizeCapability(value, path);
  if (model.maxToolIterations === undefined) {
    throw new Error(`${path}.maxToolIterations 必须显式配置`);
  }
  return {
    id: requiredString(value.id, `${path}.id`),
    ...(typeof value.label === "string" ? { label: value.label } : {}),
    enabled: value.enabled === false ? false : true,
    ...model
  };
}

function normalizeFallback(value, path) {
  return {
    pattern: requiredString(value.pattern, `${path}.pattern`),
    ...normalizeCapability(value, path)
  };
}

function normalizeCapability(value, path) {
  if (!isRecord(value)) {
    throw new Error(`${path} 必须是对象`);
  }
  const contextWindowTokens = optionalPositiveInt(value.contextWindowTokens, `${path}.contextWindowTokens`);
  const autoCompactThresholdTokens = optionalPositiveInt(
    value.autoCompactThresholdTokens,
    `${path}.autoCompactThresholdTokens`
  );
  if (
    contextWindowTokens !== undefined &&
    autoCompactThresholdTokens !== undefined &&
    autoCompactThresholdTokens > contextWindowTokens
  ) {
    throw new Error(`${path}.autoCompactThresholdTokens 不能超过 contextWindowTokens`);
  }
  return compactObject({
    reasoningModes:
      value.reasoningModes === undefined
        ? undefined
        : asArray(value.reasoningModes, `${path}.reasoningModes`).map(String),
    reasoningAlwaysOn:
      typeof value.reasoningAlwaysOn === "boolean" ? value.reasoningAlwaysOn : undefined,
    defaultReasoningMode:
      value.defaultReasoningMode === undefined
        ? undefined
        : requiredString(value.defaultReasoningMode, `${path}.defaultReasoningMode`),
    contextWindowTokens,
    autoCompactThresholdTokens,
    inputModalities:
      value.inputModalities === undefined
        ? undefined
        : asArray(value.inputModalities, `${path}.inputModalities`).map(String),
    autoCompactThresholdRatio:
      value.autoCompactThresholdRatio === undefined
        ? undefined
        : requiredRatio(value.autoCompactThresholdRatio, `${path}.autoCompactThresholdRatio`),
    maxToolIterations: optionalConfigurablePositiveInt(value.maxToolIterations, `${path}.maxToolIterations`),
    pricing: value.pricing === undefined ? undefined : normalizePricing(value.pricing, `${path}.pricing`)
  });
}

function normalizeAuth(value, path) {
  if (value === undefined) {
    return { type: "bearer" };
  }
  if (!isRecord(value)) {
    throw new Error(`${path} 必须是对象`);
  }
  return compactObject({
    type: requiredOneOf(value.type ?? "bearer", `${path}.type`, [
      "bearer",
      "x-api-key",
      "anthropic"
    ]),
    header: typeof value.header === "string" ? value.header : undefined,
    prefix: typeof value.prefix === "string" ? value.prefix : undefined,
    versionHeader: typeof value.versionHeader === "string" ? value.versionHeader : undefined,
    version: typeof value.version === "string" ? value.version : undefined
  });
}

function normalizePricing(value, path) {
  if (!isRecord(value)) {
    throw new Error(`${path} 必须是对象`);
  }
  return compactObject({
    currency: requiredString(value.currency ?? "USD", `${path}.currency`),
    inputCostPerMillion: optionalNonNegativeNumber(value.inputCostPerMillion, `${path}.inputCostPerMillion`),
    outputCostPerMillion: optionalNonNegativeNumber(value.outputCostPerMillion, `${path}.outputCostPerMillion`),
    cacheReadCostPerMillion: optionalNonNegativeNumber(value.cacheReadCostPerMillion, `${path}.cacheReadCostPerMillion`),
    cacheWriteCostPerMillion: optionalNonNegativeNumber(value.cacheWriteCostPerMillion, `${path}.cacheWriteCostPerMillion`),
    pricingSource:
      typeof value.pricingSource === "string" ? value.pricingSource : undefined
  });
}

function renderCatalog(catalog) {
  const { providers, settings } = catalog;
  const providerKinds = providers.map((provider) => provider.kind);
  return `// 此文件由 scripts/generate-provider-catalog.mjs 生成，请修改 provider-catalog.yaml 后重新生成。
export const PROVIDER_CATALOG_SETTINGS = ${JSON.stringify(settings, null, 2)} as const;

export const PROVIDER_KINDS = ${JSON.stringify(providerKinds, null, 2)} as const;

export const PROVIDER_CATALOG = ${JSON.stringify(
    Object.fromEntries(providers.map((provider) => [provider.kind, provider])),
    null,
    2
  )} as const;
`;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function asArray(value, path) {
  if (!Array.isArray(value)) {
    throw new Error(`${path} 必须是数组`);
  }
  return value;
}

function requiredString(value, path) {
  if (typeof value !== "string") {
    throw new Error(`${path} 必须是字符串`);
  }
  return value;
}

function requiredOneOf(value, path, allowed) {
  const parsed = requiredString(value, path);
  if (!allowed.includes(parsed)) {
    throw new Error(`${path} 必须是以下值之一: ${allowed.join(", ")}`);
  }
  return parsed;
}

function optionalPositiveInt(value, path) {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${path} 必须是正整数`);
  }
  return value;
}

function requiredConfigurablePositiveInt(value, path) {
  const parsed = optionalConfigurablePositiveInt(value, path);
  if (parsed === undefined) {
    throw new Error(`${path} 必须是正整数`);
  }
  return parsed;
}

function optionalConfigurablePositiveInt(value, path) {
  const parsed = optionalPositiveInt(value, path);
  if (parsed !== undefined && parsed > maxConfigurableToolIterations) {
    throw new Error(`${path} 不能超过 ${maxConfigurableToolIterations}`);
  }
  return parsed;
}

function optionalNonNegativeNumber(value, path) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || value < 0) {
    throw new Error(`${path} 必须是非负数字`);
  }
  return value;
}

function requiredPositiveNumber(value, path) {
  if (typeof value !== "number" || value <= 0) {
    throw new Error(`${path} 必须是正数`);
  }
  return value;
}

function requiredRatio(value, path) {
  if (typeof value !== "number" || value <= 0 || value > 1) {
    throw new Error(`${path} 必须是 0 到 1 之间的正数`);
  }
  return value;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
