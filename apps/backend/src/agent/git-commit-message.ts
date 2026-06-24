import type { Context } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { ProviderConfig } from "@chengxiaobang/shared";
import { buildModel, buildModelStreamOptions } from "../model/pi-model";

const MAX_STATUS_CHARS = 4000;
const MAX_DIFF_CHARS = 16000;
const MAX_COMMIT_MESSAGE_CHARS = 72;

const COMMIT_MESSAGE_PROMPT = [
  "You write Git commit messages.",
  "Return exactly one English conventional commit subject line.",
  "Requirements:",
  "- Use one of: feat, fix, chore, docs, refactor, test, perf, build, ci, style",
  "- Keep it at or under 72 characters",
  "- No markdown, no quotes, no body, no explanation"
].join("\n");

export function buildGitCommitMessageContext(input: { status: string; diff: string }): Context {
  return {
    systemPrompt: COMMIT_MESSAGE_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          "Generate a commit message for these changes.",
          "",
          "Git status:",
          clip(input.status, MAX_STATUS_CHARS),
          "",
          "Cached diff:",
          clip(input.diff, MAX_DIFF_CHARS)
        ].join("\n"),
        timestamp: Date.now()
      }
    ]
  };
}

export function normalizeGitCommitMessage(raw: string): string | undefined {
  const firstLine = raw
    .trim()
    .split("\n")[0]
    ?.replace(/^(commit message|message)[:：]\s*/i, "")
    .replace(/^["'“”‘’`]+/, "")
    .replace(/["'“”‘’`]+$/, "")
    .trim();
  if (!firstLine) {
    return undefined;
  }
  const clipped =
    firstLine.length > MAX_COMMIT_MESSAGE_CHARS
      ? firstLine.slice(0, MAX_COMMIT_MESSAGE_CHARS).trimEnd()
      : firstLine;
  return clipped || undefined;
}

export async function generateGitCommitMessage(options: {
  status: string;
  diff: string;
  provider: ProviderConfig;
  apiKey: string;
  signal: AbortSignal;
  streamFn: StreamFn;
}): Promise<string | undefined> {
  const stream = await options.streamFn(
    buildModel(options.provider),
    buildGitCommitMessageContext({ status: options.status, diff: options.diff }),
    {
      apiKey: options.apiKey,
      ...buildModelStreamOptions(options.provider),
      signal: options.signal
    }
  );
  let text = "";
  for await (const event of stream) {
    if (event.type === "text_delta") {
      text += event.delta;
    }
  }
  const result = await stream.result();
  if (result.stopReason === "error") {
    throw new Error(result.errorMessage ?? "模型请求失败");
  }
  if (result.stopReason === "aborted" || options.signal.aborted) {
    return undefined;
  }
  return normalizeGitCommitMessage(text);
}

function clip(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n...[truncated]`;
}
