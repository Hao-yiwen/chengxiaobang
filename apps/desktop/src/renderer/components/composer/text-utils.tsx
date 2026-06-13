import type { ReactNode } from "react";
import type { SlashCommand } from "@chengxiaobang/shared";

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

// 计算输入框中需要打灰底标记的特殊片段：开头的斜杠命令、以及 @ 文件引用。
// 返回按位置升序、互不重叠的区间，供 highlight overlay 渲染。
export function getComposerHighlightRanges(
  value: string,
  commands: SlashCommand[],
  allowAtTokens: boolean
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  if (value.startsWith("/")) {
    const firstLine = value.split("\n", 1)[0] ?? "";
    // 取最长的、与输入开头完整匹配的已知命令名（兼容 "/git status" 这类带空格的命令）。
    let matched = "";
    for (const command of commands) {
      const name = command.name;
      const isFullMatch =
        firstLine === name || (firstLine.startsWith(name) && firstLine[name.length] === " ");
      if (isFullMatch && name.length > matched.length) {
        matched = name;
      }
    }
    if (matched) {
      ranges.push({ start: 0, end: matched.length });
    }
  }
  if (allowAtTokens) {
    const atPattern = /(^|\s)(@[^\s@]+)/g;
    let match: RegExpExecArray | null;
    while ((match = atPattern.exec(value)) !== null) {
      const start = match.index + match[1].length;
      ranges.push({ start, end: start + match[2].length });
    }
  }
  return ranges;
}

// 把输入文本按高亮区间切片渲染：高亮片段套灰底 span，其余为透明文本（仅占位对齐，真正文字由 textarea 显示）。
export function renderHighlightNodes(
  value: string,
  ranges: Array<{ start: number; end: number }>
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    if (range.start > cursor) {
      nodes.push(<span key={`plain-${index}`}>{value.slice(cursor, range.start)}</span>);
    }
    nodes.push(
      <span
        key={`mark-${index}`}
        className="box-decoration-clone -mx-[4px] rounded-md bg-canvas-soft-2 px-[4px] py-[2px]"
      >
        {value.slice(range.start, range.end)}
      </span>
    );
    cursor = range.end;
  });
  if (cursor < value.length) {
    nodes.push(<span key="tail">{value.slice(cursor)}</span>);
  }
  return nodes;
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
  const skillCommands = commands.filter((command) => command.kind === "skill");
  const compactQuery = query.trim();
  if (!compactQuery) {
    return skillCommands;
  }
  return skillCommands.filter((command) =>
    `${command.name} ${command.description}`.toLowerCase().includes(compactQuery)
  );
}
