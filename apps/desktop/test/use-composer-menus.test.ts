// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SlashCommand } from "@chengxiaobang/shared";
import {
  filterSlashCommands,
  getAtToken,
  getSlashQuery,
  useComposerMenus,
  type ComposerMenusInput,
  type MenuSelection
} from "../src/renderer/hooks/useComposerMenus";

const commands: SlashCommand[] = [
  {
    id: "builtin:/ls",
    name: "/ls",
    kind: "builtin_tool",
    description: "列出当前项目目录内容",
    source: "builtin",
    insertText: "/ls "
  },
  {
    id: "global:skill:excel",
    name: "/excel",
    kind: "skill",
    description: "处理 Excel 表格",
    source: "global",
    insertText: "/excel "
  }
];

function setup(initial: Partial<ComposerMenusInput>) {
  return renderHook((props: Partial<ComposerMenusInput>) =>
    useComposerMenus({
      value: "",
      caretPos: 0,
      slashCommands: commands,
      ...initial,
      ...props
    }),
    { initialProps: initial }
  );
}

describe("getSlashQuery / getAtToken / filterSlashCommands", () => {
  it("parses the slash query from the first line only", () => {
    expect(getSlashQuery("/ex", 3)).toBe("ex");
    expect(getSlashQuery("hello", 3)).toBeUndefined();
    expect(getSlashQuery("/a\nb", 4)).toBeUndefined();
  });

  it("parses the @-token at the caret", () => {
    expect(getAtToken("看看 @ind", 7)).toEqual({ query: "ind", start: 3 });
    expect(getAtToken("a@b", 3)).toBeUndefined();
    expect(getAtToken("@", 1)).toEqual({ query: "", start: 0 });
  });

  it("filters slash commands by name and description", () => {
    expect(filterSlashCommands(commands, "")).toHaveLength(2);
    expect(filterSlashCommands(commands, "excel").map((c) => c.name)).toEqual(["/excel"]);
  });
});

describe("useComposerMenus", () => {
  it("activates the slash menu and navigates with arrows", () => {
    const { result } = setup({ value: "/", caretPos: 1 });

    expect(result.current.active).toBe("slash");
    expect(result.current.items).toHaveLength(2);
    expect(result.current.highlighted).toBe(0);

    let consumed = false;
    act(() => {
      consumed = result.current.onKeyDown({ key: "ArrowDown", preventDefault: vi.fn() });
    });
    expect(consumed).toBe(true);
    expect(result.current.highlighted).toBe(1);

    act(() => {
      result.current.onKeyDown({ key: "ArrowDown", preventDefault: vi.fn() });
    });
    expect(result.current.highlighted).toBe(0);
  });

  it("applies the highlighted slash command on Enter via onApply", () => {
    const applied: MenuSelection[] = [];
    const { result } = setup({
      value: "/ex",
      caretPos: 3,
      onApply: (selection) => applied.push(selection)
    });

    expect(result.current.active).toBe("slash");
    expect(result.current.items).toEqual([{ type: "slash", command: commands[1] }]);

    act(() => {
      result.current.onKeyDown({ key: "Enter", preventDefault: vi.fn() });
    });
    expect(applied).toEqual([{ nextValue: "/excel ", caret: 7 }]);
  });

  it("does not consume keys when no menu is active", () => {
    const { result } = setup({ value: "hello", caretPos: 5 });
    expect(result.current.active).toBeNull();
    expect(result.current.onKeyDown({ key: "Enter", preventDefault: vi.fn() })).toBe(false);
  });

  it("fetches file candidates with a debounce and splices the pick into the value", async () => {
    const listProjectFiles = vi.fn(async () => ["src/index.ts", "src/main-index.ts"]);
    const { result } = setup({
      value: "看看 @ind",
      caretPos: 7,
      listProjectFiles
    });

    await waitFor(() => expect(result.current.active).toBe("file"));
    expect(listProjectFiles).toHaveBeenCalledWith("ind");
    expect(result.current.items).toHaveLength(2);

    const selection = result.current.select(0);
    expect(selection).toEqual({ nextValue: "看看 @src/index.ts ", caret: 17 });
  });

  it("never fetches files without listProjectFiles (non-project session)", async () => {
    const { result } = setup({ value: "@ind", caretPos: 4 });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(result.current.active).toBeNull();
  });

  it("hides the file menu and clears candidates when the fetch fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const listProjectFiles = vi.fn(async () => {
      throw new Error("network down");
    });
    const { result } = setup({ value: "@ind", caretPos: 4, listProjectFiles });

    await waitFor(() => expect(listProjectFiles).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current.active).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("Escape dismisses the file menu for the current @-token only", async () => {
    const listProjectFiles = vi.fn(async () => ["src/index.ts"]);
    const { result, rerender } = setup({ value: "@ind", caretPos: 4, listProjectFiles });

    await waitFor(() => expect(result.current.active).toBe("file"));
    act(() => {
      result.current.onKeyDown({ key: "Escape", preventDefault: vi.fn() });
    });
    expect(result.current.active).toBeNull();

    // 新起一个 @（不同起点）重新出现。
    rerender({ value: "x @in", caretPos: 5, listProjectFiles });
    await waitFor(() => expect(result.current.active).toBe("file"));
  });

  it("Escape dismisses the slash menu until the input changes", () => {
    const { result, rerender } = setup({ value: "/", caretPos: 1 });
    expect(result.current.active).toBe("slash");

    act(() => {
      result.current.onKeyDown({ key: "Escape", preventDefault: vi.fn() });
    });
    expect(result.current.active).toBeNull();

    rerender({ value: "/e", caretPos: 2 });
    expect(result.current.active).toBe("slash");
  });
});
