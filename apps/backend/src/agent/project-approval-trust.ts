import { createHash } from "node:crypto";
import { nowIso } from "@chengxiaobang/shared";
import type { StateStore } from "../repository/state-store";

const SETTINGS_KEY = "approval.projectTrustedToolCalls.v1";

type SettingsStore = Pick<StateStore, "getSetting" | "setSetting">;

export interface ProjectApprovalTrustInput {
  projectId?: string | null;
  toolName: string;
  args: Record<string, unknown>;
}

interface ProjectApprovalTrustRule {
  projectId: string;
  toolName: string;
  argsHash: string;
  createdAt: string;
}

/**
 * 项目级审批信任：只保存参数签名，不保存命令正文或文件内容。
 * 命中粒度固定为 projectId + toolName + 规范化参数 hash。
 */
export class ProjectApprovalTrustService {
  constructor(private readonly store: SettingsStore) {}

  async isTrusted(input: ProjectApprovalTrustInput): Promise<boolean> {
    if (!input.projectId) {
      return false;
    }
    const argsHash = projectApprovalArgsHash(input.toolName, input.args);
    const rules = await this.loadRules();
    const trusted = rules.some(
      (rule) =>
        rule.projectId === input.projectId &&
        rule.toolName === input.toolName &&
        rule.argsHash === argsHash
    );
    if (trusted) {
      console.info("[project-approval-trust] 命中项目级信任规则", {
        projectId: input.projectId,
        toolName: input.toolName,
        argsHash
      });
    }
    return trusted;
  }

  async trust(input: ProjectApprovalTrustInput): Promise<boolean> {
    if (!input.projectId) {
      console.warn("[project-approval-trust] 缺少项目，无法记录项目级信任规则", {
        toolName: input.toolName
      });
      return false;
    }
    const argsHash = projectApprovalArgsHash(input.toolName, input.args);
    const rules = await this.loadRules();
    if (
      rules.some(
        (rule) =>
          rule.projectId === input.projectId &&
          rule.toolName === input.toolName &&
          rule.argsHash === argsHash
      )
    ) {
      console.debug("[project-approval-trust] 项目级信任规则已存在", {
        projectId: input.projectId,
        toolName: input.toolName,
        argsHash
      });
      return true;
    }
    rules.push({
      projectId: input.projectId,
      toolName: input.toolName,
      argsHash,
      createdAt: nowIso()
    });
    await this.store.setSetting(SETTINGS_KEY, JSON.stringify(rules));
    console.info("[project-approval-trust] 已记录项目级信任规则", {
      projectId: input.projectId,
      toolName: input.toolName,
      argsHash
    });
    return true;
  }

  async rawSettingsForTest(): Promise<string | undefined> {
    return this.store.getSetting(SETTINGS_KEY);
  }

  private async loadRules(): Promise<ProjectApprovalTrustRule[]> {
    const raw = await this.store.getSetting(SETTINGS_KEY);
    if (!raw) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        console.warn("[project-approval-trust] settings 格式非法，已忽略");
        return [];
      }
      return parsed.filter(isRule);
    } catch (error) {
      console.warn("[project-approval-trust] settings JSON 解析失败，已忽略", {
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }
}

export function projectApprovalArgsHash(
  toolName: string,
  args: Record<string, unknown>
): string {
  return createHash("sha256")
    .update(stableStringify({ toolName, args: normalizeApprovalArgs(toolName, args) }))
    .digest("hex");
}

export function normalizeApprovalArgs(
  toolName: string,
  args: Record<string, unknown>
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(args).sort()) {
    normalized[key] = normalizeValue(toolName, key, args[key]);
  }
  return normalized;
}

function normalizeValue(toolName: string, key: string, value: unknown): unknown {
  if (typeof value === "string") {
    if (toolName === "Bash" && key === "command") {
      return value.replace(/\s+/g, " ").trim();
    }
    if (isPathKey(key)) {
      return value.replace(/\\/g, "/");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(toolName, key, item));
  }
  if (value && typeof value === "object") {
    const normalized: Record<string, unknown> = {};
    for (const nestedKey of Object.keys(value as Record<string, unknown>).sort()) {
      normalized[nestedKey] = normalizeValue(
        toolName,
        nestedKey,
        (value as Record<string, unknown>)[nestedKey]
      );
    }
    return normalized;
  }
  return value === undefined ? null : value;
}

function isPathKey(key: string): boolean {
  return key === "path" || key === "file_path" || key === "old_path" || key === "new_path";
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isRule(value: unknown): value is ProjectApprovalTrustRule {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.projectId === "string" &&
    typeof record.toolName === "string" &&
    typeof record.argsHash === "string" &&
    typeof record.createdAt === "string"
  );
}
