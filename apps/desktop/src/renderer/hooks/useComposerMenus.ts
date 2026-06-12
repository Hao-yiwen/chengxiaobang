import { useCallback, useEffect, useMemo, useState } from "react";
import type { SlashCommand } from "@chengxiaobang/shared";

/**
 * Composer 的 slash/@ 双菜单状态机（UI-SPEC §6，解短板 8）。
 *
 * 纯逻辑层：根据 value + caretPos 推导哪一个菜单激活、候选项与高亮项，
 * 并把键盘交互（↑↓ / Enter / Tab / Escape）收敛为「是否已消费」的布尔值。
 * 文件候选的拉取（150ms 防抖）也在此处，注入 listProjectFiles 即可单测。
 */

export type ComposerMenuKind = "slash" | "file";

export type MenuItem =
  | { type: "slash"; command: SlashCommand }
  | { type: "file"; path: string };

/** 命中候选后应回填到输入框的完整新值与光标位置。 */
export interface MenuSelection {
  nextValue: string;
  caret: number;
}

export interface ComposerMenusInput {
  value: string;
  caretPos: number;
  slashCommands: SlashCommand[];
  /** 项目会话才注入；缺省时 @ 文件菜单整体停用（不发请求）。 */
  listProjectFiles?: (query: string) => Promise<string[]>;
  /** Enter/Tab 命中候选时回调（由组件应用到 textarea）。 */
  onApply?: (selection: MenuSelection) => void;
}

export interface ComposerMenus {
  active: ComposerMenuKind | null;
  items: MenuItem[];
  highlighted: number;
  setHighlighted(index: number): void;
  /** 返回 true 表示按键已被菜单消费，组件不应再处理。 */
  onKeyDown(event: { key: string; preventDefault(): void }): boolean;
  select(index: number): MenuSelection | undefined;
}

const FILE_FETCH_DEBOUNCE_MS = 150;

/** 输入以 / 开头且光标仍在首行时的 slash 查询词（去掉前导 /，小写）。 */
export function getSlashQuery(value: string, caretPos: number): string | undefined {
  if (!value.startsWith("/")) {
    return undefined;
  }
  const cursor = Math.max(0, Math.min(caretPos, value.length));
  const beforeCursor = value.slice(0, cursor);
  if (beforeCursor.includes("\n")) {
    return undefined;
  }
  const firstLine = value.split("\n", 1)[0] ?? "";
  if (cursor > firstLine.length) {
    return undefined;
  }
  return beforeCursor.slice(1).toLowerCase();
}

/**
 * 光标处正在输入的 @-token：`@src/uti` -> { query, "@"的起点 }。
 * token 必须在行首或空白后开始，且不含空白与另一个 @。
 */
export function getAtToken(
  value: string,
  caretPos: number
): { query: string; start: number } | undefined {
  const cursor = Math.max(0, Math.min(caretPos, value.length));
  const before = value.slice(0, cursor);
  const match = before.match(/(^|\s)@([^\s@]*)$/);
  if (!match) {
    return undefined;
  }
  return { query: match[2], start: cursor - match[2].length - 1 };
}

export function filterSlashCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  const compactQuery = query.trim();
  if (!compactQuery) {
    return commands;
  }
  return commands.filter((command) =>
    `${command.name} ${command.description}`.toLowerCase().includes(compactQuery)
  );
}

export function useComposerMenus(input: ComposerMenusInput): ComposerMenus {
  const { value, caretPos, slashCommands, listProjectFiles, onApply } = input;

  const [highlighted, setHighlighted] = useState(0);
  const [files, setFiles] = useState<string[]>([]);
  // Escape 抑制：slash 按当前输入值记忆（任何编辑都解除），file 按 @ 起点记忆。
  const [dismissedSlashValue, setDismissedSlashValue] = useState<string>();
  const [dismissedAtStart, setDismissedAtStart] = useState<number>();

  const slashQuery = getSlashQuery(value, caretPos);
  const filteredCommands = useMemo(
    () => filterSlashCommands(slashCommands, slashQuery ?? ""),
    [slashCommands, slashQuery]
  );
  const atToken = listProjectFiles ? getAtToken(value, caretPos) : undefined;
  const atTokenQuery = atToken?.query;
  const atTokenStart = atToken?.start;

  // @ 文件候选：150ms 防抖拉取；失败记日志并清空（菜单自然隐藏）。
  useEffect(() => {
    if (!listProjectFiles || atTokenQuery === undefined) {
      return;
    }
    const timer = window.setTimeout(() => {
      listProjectFiles(atTokenQuery)
        .then(setFiles)
        .catch((error) => {
          console.warn(`[useComposerMenus] 文件候选拉取失败 query=${atTokenQuery}`, error);
          setFiles([]);
        });
    }, FILE_FETCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [atTokenQuery, listProjectFiles]);

  const slashActive =
    slashQuery !== undefined && filteredCommands.length > 0 && value !== dismissedSlashValue;
  const fileActive =
    !slashActive &&
    atToken !== undefined &&
    atTokenStart !== dismissedAtStart &&
    files.length > 0;
  const active: ComposerMenuKind | null = slashActive ? "slash" : fileActive ? "file" : null;

  const items = useMemo<MenuItem[]>(() => {
    if (slashActive) {
      return filteredCommands.map((command) => ({ type: "slash" as const, command }));
    }
    if (fileActive) {
      return files.map((path) => ({ type: "file" as const, path }));
    }
    return [];
  }, [slashActive, fileActive, filteredCommands, files]);

  // 候选集变化时复位高亮（与原 Composer 行为一致）。
  useEffect(() => {
    setHighlighted(0);
  }, [slashQuery, filteredCommands.length, atTokenQuery, files.length]);

  const select = useCallback(
    (index: number): MenuSelection | undefined => {
      if (slashActive) {
        const command = filteredCommands[index] ?? filteredCommands[0];
        if (!command) {
          return undefined;
        }
        return { nextValue: command.insertText, caret: command.insertText.length };
      }
      if (fileActive && atToken !== undefined) {
        const path = files[index] ?? files[0];
        if (!path) {
          return undefined;
        }
        const cursor = Math.max(0, Math.min(caretPos, value.length));
        const nextValue = `${value.slice(0, atToken.start)}@${path} ${value.slice(cursor)}`;
        return { nextValue, caret: atToken.start + path.length + 2 };
      }
      return undefined;
    },
    [slashActive, fileActive, filteredCommands, files, atToken, caretPos, value]
  );

  const onKeyDown = useCallback(
    (event: { key: string; preventDefault(): void }): boolean => {
      if (!active || items.length === 0) {
        return false;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlighted((index) => (index + 1) % items.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlighted((index) => (index - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const selection = select(highlighted);
        if (selection) {
          onApply?.(selection);
        }
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (active === "slash") {
          setDismissedSlashValue(value);
        } else if (atTokenStart !== undefined) {
          setDismissedAtStart(atTokenStart);
        }
        return true;
      }
      return false;
    },
    [active, items.length, select, highlighted, onApply, value, atTokenStart]
  );

  return { active, items, highlighted, setHighlighted, onKeyDown, select };
}
