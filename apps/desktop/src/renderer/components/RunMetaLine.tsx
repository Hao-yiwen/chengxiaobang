/**
 * RunMetaLine 仪表行（UI-SPEC §3.2）。
 *
 * 每个 assistant turn 末尾常驻一行：`12.4s · 2,113 tok · deepseek-v4-flash`
 * （10.5px mono ink-4 tnum）。hover 延迟 80ms 在行尾浮现 复制/重新生成/fork
 * 三个 12px 动作钮（§13.16），离开即隐。纯 props 驱动，不 import store——
 * runMeta 数据（按 assistantMessageId 取数，取不到整行不渲染）由父层负责。
 */
import {
  ArrowClockwiseIcon as RefreshCw,
  CopyIcon as Copy,
  GitForkIcon as GitFork
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ReasoningMode } from "@chengxiaobang/shared";
import { MetaActionButton } from "@/components/MessageActions";
import { reasoningModeLabel } from "@/components/ProviderModelControls";
import { StampBadge } from "@/components/StampBadge";

export interface RunMetaLineProps {
  durationMs: number;
  /** prompt + completion 总 token 数。 */
  totalTokens: number;
  model: string;
  reasoningMode?: ReasoningMode;
  onCopy(): void;
  onRegenerate(): void;
  onFork(): void;
}

/** 时长格式（§3.2）：<60s 取一位小数（12.4s），≥60s 用 `1m 12s`。 */
export function formatRunDuration(ms: number): string {
  const clamped = Math.max(0, ms);
  if (clamped < 60_000) return `${(clamped / 1000).toFixed(1)}s`;
  const totalSeconds = Math.round(clamped / 1000);
  return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
}

/** token 计数（§3.2）：千分位 + tok 后缀，如 `2,113 tok`。 */
export function formatTokenCount(total: number): string {
  return `${Math.max(0, Math.round(total)).toLocaleString("en-US")} tok`;
}

const COPY_RECEIPT_MS = 1500;

export function RunMetaLine({
  durationMs,
  totalTokens,
  model,
  reasoningMode,
  onCopy,
  onRegenerate,
  onFork
}: RunMetaLineProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const receiptTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(receiptTimer.current), []);
  const modelLabel = reasoningMode
    ? `${model} · ${reasoningModeLabel(t, reasoningMode)}`
    : model;

  function handleCopy(): void {
    console.debug(
      `[run-meta] 复制本轮回答 model=${model} reasoningMode=${reasoningMode ?? "default"}`
    );
    onCopy();
    // 复制回执（§13.2）：图标换 StampBadge「已录」，1.5s 淡回，不弹 toast。
    setCopied(true);
    window.clearTimeout(receiptTimer.current);
    receiptTimer.current = window.setTimeout(() => setCopied(false), COPY_RECEIPT_MS);
  }

  return (
    <div className="group/meta mt-1 flex items-center gap-2">
      <span className="tnum font-mono text-[10.5px] text-ink-4">
        {`${formatRunDuration(durationMs)} · ${formatTokenCount(totalTokens)} · ${modelLabel}`}
      </span>
      {/* hover 延迟 80ms 现身（delay 只挂在 hover 态上），离开即隐；聚焦时常显。 */}
      <span className="flex items-center gap-0.5 opacity-0 transition-opacity duration-[120ms] focus-within:opacity-100 group-hover/meta:opacity-100 group-hover/meta:delay-[80ms]">
        <MetaActionButton
          label={copied ? t("chat.copied") : t("chat.copy")}
          onClick={handleCopy}
        >
          {copied ? (
            <StampBadge text={t("chat.copyReceipt")} fullLabel={t("chat.copied")} tone="moss" />
          ) : (
            <Copy className="size-3" />
          )}
        </MetaActionButton>
        <MetaActionButton label={t("chat.regenerate")} onClick={onRegenerate}>
          <RefreshCw className="size-3" />
        </MetaActionButton>
        <MetaActionButton label={t("chat.forkFromHere")} onClick={onFork}>
          <GitFork className="size-3" />
        </MetaActionButton>
      </span>
    </div>
  );
}
