import type { ReactNode } from "react";
import type { SlashCommand } from "@chengxiaobang/shared";

export type ComposerHighlightRange = {
  start: number;
  end: number;
  kind: "command" | "skill" | "file";
};

/**
 * 光标前正在输入的 @ token：`@src/uti` -> { query, start of "@" }。
 * token 必须位于输入开头或空白字符之后，且内部不能包含空白或另一个 @。
 */
export function getAtToken(
  value: string,
  selectionStart: number
): { query: string; start: number } | undefined {
  const cursor = Math.max(0, Math.min(selectionStart, value.length));
  const before = value.slice(0, cursor);
  const match = before.match(/(^|\s)@([^\s@]*)$/);
  if (!match) {
    return undefined;
  }
  return { query: match[2], start: cursor - match[2].length - 1 };
}

// 计算输入框中需要渲染成 token 的特殊片段：开头的斜杠命令、以及 @ 文件引用。
// 返回按位置升序、互不重叠的区间，供 highlight overlay 渲染。
export function getComposerHighlightRanges(
  value: string,
  commands: SlashCommand[],
  allowAtTokens: boolean
): ComposerHighlightRange[] {
  const ranges: ComposerHighlightRange[] = [];
  if (value.startsWith("/")) {
    const firstLine = value.split("\n", 1)[0] ?? "";
    // 取最长的、与输入开头完整匹配的已知命令名，避免已插入命令只高亮前缀。
    let matchedCommand: SlashCommand | undefined;
    for (const command of commands) {
      const name = command.name;
      const isFullMatch =
        firstLine === name || (firstLine.startsWith(name) && firstLine[name.length] === " ");
      if (isFullMatch && name.length > (matchedCommand?.name.length ?? 0)) {
        matchedCommand = command;
      }
    }
    if (matchedCommand) {
      ranges.push({
        start: 0,
        end: matchedCommand.name.length,
        kind: matchedCommand.kind === "skill" ? "skill" : "command"
      });
    }
  }
  if (allowAtTokens) {
    const atPattern = /(^|\s)(@[^\s@]+)/g;
    let match: RegExpExecArray | null;
    while ((match = atPattern.exec(value)) !== null) {
      const start = match.index + match[1].length;
      ranges.push({ start, end: start + match[2].length, kind: "file" });
    }
  }
  return ranges;
}

// 把输入文本按高亮区间切片渲染：overlay 完整承载可见文本，textarea 只保留真实输入和光标。
export function renderHighlightNodes(
  value: string,
  ranges: ComposerHighlightRange[]
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    if (range.start > cursor) {
      nodes.push(<span key={`plain-${index}`}>{value.slice(cursor, range.start)}</span>);
    }
    nodes.push(
      <ComposerToken
        key={`mark-${index}`}
        range={range}
        text={value.slice(range.start, range.end)}
      />
    );
    cursor = range.end;
  });
  if (cursor < value.length) {
    nodes.push(<span key="tail">{value.slice(cursor)}</span>);
  }
  return nodes;
}

function ComposerToken({ range, text }: { range: ComposerHighlightRange; text: string }) {
  if (range.kind === "file") {
    return (
      <span data-testid="composer-token-file" className="font-medium text-link-deep">
        {text}
      </span>
    );
  }
  return (
    <span
      data-testid={`composer-token-${range.kind}`}
      className="box-decoration-clone -mx-[4px] rounded-md bg-canvas-soft-2 px-[4px] py-[2px]"
    >
      {text}
    </span>
  );
}

export function getSlashQuery(value: string, selectionStart: number): string | undefined {
  if (!value.startsWith("/")) {
    return undefined;
  }
  const cursor = Math.max(0, Math.min(selectionStart, value.length));
  const beforeCursor = value.slice(0, cursor);
  if (beforeCursor.includes("\n")) {
    return undefined;
  }
  const firstLine = value.split("\n", 1)[0] ?? "";
  if (cursor > firstLine.length) {
    return undefined;
  }
  const afterSlash = beforeCursor.slice(1);
  // 命令一旦带空格即视为已选定（菜单只列技能，技能名无空格），收起补全框，避免残留只剩一项的小框。
  if (/\s/.test(afterSlash)) {
    return undefined;
  }
  return afterSlash.toLowerCase();
}

export function filterSlashCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  const visibleCommands = commands.filter(
    (command) => command.kind === "skill" || command.name === "/compact"
  );
  const compactQuery = query.trim();
  if (!compactQuery) {
    return visibleCommands;
  }
  return visibleCommands.filter((command) =>
    `${command.name} ${command.description}`.toLowerCase().includes(compactQuery)
  );
}
