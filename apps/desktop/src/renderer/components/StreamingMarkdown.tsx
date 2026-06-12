import { useMemo, useRef, type ComponentType } from "react";
import { Markdown } from "@/components/Markdown";
import {
  STREAM_ANIM_FUSE_BYTES,
  lexStreamBlocks,
  repairStart,
  repairStreamingMarkdown,
  utf8ByteLength,
  type StreamBlock
} from "@/lib/streaming-markdown";
import { cn } from "@/lib/utils";

/**
 * WP-H1 接口约定（UI-SPEC §4.1）：`Markdown` 将提供 `appendCaret?: boolean`，
 * 在覆写组件的最末段落/列表项/标题闭合前注入 `<span class="ink-caret">`。
 * 在该 prop 落地前以本地类型描述约定，保证两包并行期 typecheck 互不阻塞。
 */
const BlockMarkdown = Markdown as ComponentType<{
  text: string;
  className?: string;
  appendCaret?: boolean;
}>;

/** 渲染中每帧的处理快照，用于跨 delta 的 key 审计与保险丝判定。 */
interface ProcessedFrame {
  text: string;
  repaired: string;
  blocks: StreamBlock[];
}

/**
 * dev 断言（UI-SPEC §4.2 规则 4）：禁止偏移连锁导致整列 remount。
 * 稳定边界 = 前后两帧修复文的公共前缀偏移；完全位于边界之前的块 key 必须不变。
 * 单次 delta 后 key 失效数 > 3，或任何「已稳定块」丢 key，都 console.warn
 * 带前后块摘要，留排查日志。
 */
function auditBlockKeys(prev: ProcessedFrame, next: ProcessedFrame): void {
  const boundary = repairStart(prev.repaired, next.repaired);
  const nextKeys = new Set(next.blocks.map((block) => block.key));
  const invalidated = prev.blocks.filter((block) => !nextKeys.has(block.key));
  // 块尾恰好落在 boundary 上属合法变更（delta 正接在该块末尾续写，段落长成
  // 列表即此例）；只有整块严格位于改写偏移之前、key 却失效的才算连锁 remount。
  const violations = invalidated.filter(
    (block) => block.startOffset + block.raw.length < boundary
  );
  if (violations.length === 0 && invalidated.length <= 3) {
    return;
  }
  const summarize = (blocks: StreamBlock[]) =>
    blocks.map((block) => `${block.key}«${block.raw.slice(0, 16)}»`);
  console.warn("[StreamingMarkdown] 块 key 集合异常变更（offset 连锁 remount 嫌疑）", {
    boundary,
    invalidatedCount: invalidated.length,
    violations: summarize(violations),
    prevBlocks: summarize(prev.blocks),
    nextBlocks: summarize(next.blocks)
  });
}

/**
 * Streaming variant of `Markdown`（UI-SPEC §4）：累计文本先经 remend 尾部修复，
 * 再由 marked lexer 切顶层块，每块独立 memoized `<Markdown>`，每个 delta 只重
 * parse 尾块。
 *
 * - key＝`${startOffset}:${type}` 偏移哈希（§4.2）。前提：流式输入 append-only、
 *   remend 只改写尾部切片，因此前缀块 key 恒定，块长大不 remount、不重放动画。
 * - 新块挂 `animate-msg-in` 入场；单次 flush delta > 2KB 时本批新块加
 *   `data-no-anim` 跳过动画（§4.3 保险丝）。
 * - 尾块经 `appendCaret` 注入行内墨点；尾块是代码块时光标挂在代码块下一行
 *   行首（§4.1）。streamText 非空时 stream 即墨点 owner（§2.3 优先级最高），
 *   故无需在此判定 owner。
 */
export function StreamingMarkdown({ text, className }: { text: string; className?: string }) {
  const { repaired, blocks } = useMemo(() => {
    const repairedText = repairStreamingMarkdown(text);
    return { repaired: repairedText, blocks: lexStreamBlocks(repairedText) };
  }, [text]);

  // 渲染期缓存（确定性、幂等，StrictMode 双调安全）：
  // - lastFrameRef：上一帧快照，用于 delta 字节数与 key 审计；
  // - animByKeyRef：每个块首次出现时一次性决定入场方式，之后不再改判。
  const lastFrameRef = useRef<ProcessedFrame | null>(null);
  const animByKeyRef = useRef(new Map<string, "animate" | "fuse">());

  if (lastFrameRef.current?.text !== text) {
    const prev = lastFrameRef.current;
    const deltaBytes =
      prev && text.startsWith(prev.text)
        ? utf8ByteLength(text.slice(prev.text.length))
        : utf8ByteLength(text);
    const fuse = deltaBytes > STREAM_ANIM_FUSE_BYTES;
    const decisions = animByKeyRef.current;
    const currentKeys = new Set<string>();
    for (const block of blocks) {
      currentKeys.add(block.key);
      if (!decisions.has(block.key)) {
        decisions.set(block.key, fuse ? "fuse" : "animate");
      }
    }
    for (const key of decisions.keys()) {
      if (!currentKeys.has(key)) {
        decisions.delete(key);
      }
    }
    if (import.meta.env.DEV && prev) {
      auditBlockKeys(prev, { text, repaired, blocks });
    }
    lastFrameRef.current = { text, repaired, blocks };
  }

  const tailIndex = blocks.length - 1;
  const tailIsCode = blocks[tailIndex]?.type === "code";

  return (
    <div className={cn("space-y-3", className)}>
      {blocks.map((block, index) => {
        const isTail = index === tailIndex;
        const fused = animByKeyRef.current.get(block.key) === "fuse";
        return (
          <div
            key={block.key}
            className={fused ? undefined : "animate-msg-in"}
            data-no-anim={fused ? "" : undefined}
          >
            <BlockMarkdown text={block.raw} appendCaret={isTail && !tailIsCode} />
            {isTail && tailIsCode ? (
              // 代码块尾块流式中：光标挂在代码块下一行行首（§4.1）。
              <div className="leading-[21px]">
                <span className="ink-caret" aria-hidden />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
