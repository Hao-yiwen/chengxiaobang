// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import { DEFAULT_CODE_PREVIEW_SETTINGS } from "../src/renderer/lib/code-preview-settings";
import {
  extensionOf,
  previewDescriptorForKind,
  previewKindForPath,
  type PreviewKind
} from "../src/common/file-preview";
import type { ApiClient } from "../src/renderer/lib/api";
import type { TerminalDataEvent, TerminalExitEvent } from "../src/renderer/global";
import { resetAppStore, useAppStore } from "../src/renderer/store";
import { RIGHT_PANEL_FILE_WIDTH } from "../src/renderer/store/helpers/right-panel";
import type {
  Message,
  Project,
  ProjectFileEntry,
  ProviderConfig,
  Session,
  ToolCall
} from "@chengxiaobang/shared";

const terminalMock = vi.hoisted(() => {
  type MockTerminalTheme = Record<string, string>;
  type MockTerminalOptions = {
    theme?: MockTerminalTheme;
    [key: string]: unknown;
  };

  class MockTerminal {
    static instances: MockTerminal[] = [];
    cols = 80;
    rows = 24;
    element?: HTMLElement;
    initialOptions: MockTerminalOptions;
    options: MockTerminalOptions;
    currentTheme?: MockTerminalTheme;
    themeAssignments: MockTerminalTheme[] = [];
    dataListeners: Array<(data: string) => void> = [];
    focus = vi.fn();
    dispose = vi.fn();
    write = vi.fn((data: string) => {
      if (this.element) {
        this.element.textContent = `${this.element.textContent ?? ""}${data}`;
      }
    });

    constructor(options: MockTerminalOptions = {}) {
      this.initialOptions = options;
      this.currentTheme = options.theme;
      const terminalOptions = { ...options };
      Object.defineProperty(terminalOptions, "theme", {
        configurable: true,
        get: () => this.currentTheme,
        set: (theme: MockTerminalTheme | undefined) => {
          this.currentTheme = theme;
          if (theme) {
            this.themeAssignments.push(theme);
          }
        }
      });
      this.options = terminalOptions;
      MockTerminal.instances.push(this);
    }

    loadAddon(addon: { activate?: (terminal: MockTerminal) => void }): void {
      addon.activate?.(this);
    }

    open(element: HTMLElement): void {
      this.element = element;
    }

    onData(listener: (data: string) => void): { dispose: () => void } {
      this.dataListeners.push(listener);
      return {
        dispose: () => {
          this.dataListeners = this.dataListeners.filter((item) => item !== listener);
        }
      };
    }

    emitData(data: string): void {
      for (const listener of this.dataListeners) {
        listener(data);
      }
    }
  }

  class MockFitAddon {
    fit = vi.fn(() => {
      const terminal = MockTerminal.instances.at(-1);
      if (terminal) {
        terminal.cols = 100;
        terminal.rows = 30;
      }
    });
  }

  return { MockTerminal, MockFitAddon };
});

const LIGHT_TERMINAL_THEME_TOKENS: Record<string, string> = {
  "--canvas": "255 255 255",
  "--canvas-soft": "250 250 250",
  "--canvas-soft-2": "245 245 245",
  "--ink": "23 23 23",
  "--body": "77 77 77",
  "--mute": "136 136 136",
  "--border": "235 235 235",
  "--link": "0 112 243",
  "--link-bg-soft": "211 229 255",
  "--soft-blue": "64 118 190",
  "--soft-blue-strong": "38 88 152",
  "--soft-blue-foreground": "45 83 135",
  "--error": "238 0 0",
  "--warning": "245 166 35",
  "--violet": "121 40 202"
};

const DARK_TERMINAL_THEME_TOKENS: Record<string, string> = {
  ...LIGHT_TERMINAL_THEME_TOKENS,
  "--canvas": "18 18 18",
  "--canvas-soft": "10 10 10",
  "--canvas-soft-2": "38 38 38",
  "--ink": "250 250 250",
  "--body": "209 209 209",
  "--mute": "136 136 136",
  "--border": "38 38 38",
  "--link": "82 168 255",
  "--link-bg-soft": "0 49 102",
  "--soft-blue": "82 168 255",
  "--soft-blue-strong": "147 197 253",
  "--soft-blue-foreground": "147 197 253",
  "--error": "255 77 79"
};

function setTerminalThemeTokens(tokens = LIGHT_TERMINAL_THEME_TOKENS): void {
  for (const [variable, value] of Object.entries(tokens)) {
    document.documentElement.style.setProperty(variable, value);
  }
}

const shikiMock = vi.hoisted(() => ({
  bundledLanguages: {
    javascript: {},
    json: {},
    jsx: {},
    tsx: {},
    typescript: {}
  },
  codeToTokensWithThemes: vi.fn(async (text: string) =>
    text.replace(/\r\n?/g, "\n").split("\n").map((line) =>
      line
        ? [
            {
              content: line,
              variants: {
                light: { color: "#d73a49" },
                dark: { color: "#f97583" }
              }
            }
          ]
        : []
    )
  )
}));

vi.mock("@xterm/xterm", () => ({ Terminal: terminalMock.MockTerminal }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: terminalMock.MockFitAddon }));
vi.mock("shiki", () => shikiMock);
vi.mock("@pierre/diffs/react", () => ({
  FileDiff: ({ fileDiff }: { fileDiff: { additionLines: string[]; deletionLines: string[] } }) =>
    [...fileDiff.deletionLines, ...fileDiff.additionLines].join("\n"),
  MultiFileDiff: ({
    oldFile,
    newFile
  }: {
    oldFile: { contents: string };
    newFile: { contents: string };
  }) => `${oldFile.contents}\n${newFile.contents}`
}));
vi.mock("mammoth", () => ({
  default: {
    convertToHtml: vi.fn(async () => ({ value: "<p>DOCX 内容预览</p>", messages: [] }))
  }
}));
vi.mock("xlsx", () => ({
  read: vi.fn(() => ({ SheetNames: ["Sheet1"], Sheets: { Sheet1: {} } })),
  utils: {
    sheet_to_json: vi.fn(() => [
      ["标题", "数量"],
      ["苹果", 3]
    ])
  }
}));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(() => ({
    promise: Promise.resolve({
      numPages: 1,
      cleanup: vi.fn(async () => undefined),
      getPage: vi.fn(async () => ({
        getViewport: vi.fn(() => ({ width: 120, height: 80 })),
        render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }))
      }))
    })
  }))
}));
const pptxRendererMock = vi.hoisted(() => {
  const goToSlide = vi.fn(async (index: number) => undefined);
  const setZoom = vi.fn(async (zoom: number) => undefined);
  const destroy = vi.fn();
  const open = vi.fn(async (
    _input: ArrayBuffer,
    container: HTMLElement,
    options?: {
      onSlideChange?: (index: number) => void;
      onRenderComplete?: () => void;
    }
  ) => {
    container.innerHTML = [
      '<section data-testid="pptx-rendered">',
      "<p>第 1 页</p>",
      "<p>第 2 页</p>",
      "</section>"
    ].join("");
    options?.onSlideChange?.(0);
    options?.onRenderComplete?.();
    goToSlide.mockImplementation(async (index: number) => {
      options?.onSlideChange?.(index);
    });
    setZoom.mockImplementation(async () => undefined);
    return {
      slideCount: 2,
      currentSlideIndex: 0,
      zoomPercent: 100,
      goToSlide,
      setZoom,
      destroy
    };
  });
  return { open, goToSlide, setZoom, destroy };
});

vi.mock("@aiden0z/pptx-renderer", () => ({
  RECOMMENDED_ZIP_LIMITS: { maxEntries: 4000 },
  PptxViewer: {
    open: pptxRendererMock.open
  }
}));

const provider: ProviderConfig = {
  id: "deepseek",
  kind: "deepseek",
  name: "DeepSeek",
  baseURL: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  apiKeyRef: "test:deepseek",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const project: Project = {
  id: "project_1",
  name: "demo",
  path: "/tmp/demo",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const session: Session = {
  id: "session_1",
  projectId: project.id,
  title: "项目对话",
  providerId: provider.id,
  accessMode: "approval",
  createdAt: "2026-06-08T00:00:00.000Z",
  updatedAt: "2026-06-08T00:00:02.000Z"
};

const secondSession: Session = {
  id: "session_3",
  projectId: project.id,
  title: "另一个项目对话",
  providerId: provider.id,
  accessMode: "approval",
  createdAt: "2026-06-08T00:00:00.000Z",
  updatedAt: "2026-06-08T00:00:02.000Z"
};

/** A conversation-mode session (no project) for the no-project panel hints. */
const conversationSession: Session = {
  id: "session_2",
  projectId: null,
  title: "纯对话",
  providerId: provider.id,
  accessMode: "approval",
  createdAt: "2026-06-08T00:00:00.000Z",
  updatedAt: "2026-06-08T00:00:02.000Z"
};

function artifactMessage(
  path: string,
  options: { id?: string; sessionId?: string; createdAt?: string } = {}
): Message {
  const escapedPath = path.replace(/&/gu, "&amp;").replace(/"/gu, "&quot;");
  return {
    id: options.id ?? `artifact-${path}`,
    sessionId: options.sessionId ?? session.id,
    role: "assistant",
    content: [
      "最终产物已生成。",
      "",
      "<artifacts>",
      `  <artifact path="${escapedPath}" />`,
      "</artifacts>"
    ].join("\n"),
    createdAt: options.createdAt ?? "2026-06-08T00:00:02.000Z"
  };
}

function createClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listProjects: vi.fn(async () => [project]),
    createProject: vi.fn() as never,
    listProjectDirectory: vi.fn(async () => []),
    listSessions: vi.fn(async () => [session]),
    updateSession: vi.fn() as never,
    deleteSession: vi.fn() as never,
    getGitInfo: vi.fn(async () => ({ isRepo: false })),
    getGitChanges: vi.fn(async () => ({ isRepo: false, files: [] })),
    listMessages: vi.fn(async () => []),
    listSessionRuns: vi.fn(async () => ({ runs: [], toolCalls: [] })),
    listSlashCommands: vi.fn(async () => ({ commands: [], diagnostics: [] })),
    listTasks: vi.fn(async () => []),
    listProviders: vi.fn(async () => [provider]),
    saveProvider: vi.fn() as never,
    deleteProvider: vi.fn(async () => true),
    testProvider: vi.fn() as never,
    getFeishuConfig: vi.fn(async () => ({ enabled: false, appId: "", domain: "feishu" as const, fullAccess: false })),
    saveFeishuConfig: vi.fn() as never,
    getFeishuStatus: vi.fn(async () => ({ status: "disconnected" as const })),
    approve: vi.fn() as never,
    abort: vi.fn() as never,
    terminalExec: vi.fn() as never,
    streamRun: vi.fn() as never,
    ...overrides
  };
}

beforeEach(() => {
  document.documentElement.classList.remove("dark", "theme-switching");
  document.documentElement.removeAttribute("style");
  setTerminalThemeTokens();
  window.localStorage.clear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      disconnect(): void {}
    }
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  terminalMock.MockTerminal.instances.length = 0;
  pptxRendererMock.open.mockClear();
  pptxRendererMock.goToSlide.mockClear();
  pptxRendererMock.setZoom.mockClear();
  pptxRendererMock.destroy.mockClear();
  shikiMock.codeToTokensWithThemes.mockClear();
  resetAppStore();
  useAppStore.setState({ onboardingOpen: false, onboardingCompleted: true });
});

afterEach(() => {
  delete (window as { chengxiaobang?: unknown }).chengxiaobang;
  document.documentElement.classList.remove("dark", "theme-switching");
  vi.unstubAllGlobals();
});

function installTerminalBridge() {
  const dataListeners = new Set<(event: TerminalDataEvent) => void>();
  const exitListeners = new Set<(event: TerminalExitEvent) => void>();
  const bridge = {
    getBackendInfo: vi.fn(async () => undefined),
    pickDirectory: vi.fn(async () => undefined),
    pickFiles: vi.fn(async () => []),
    readFileText: vi.fn() as never,
    terminalStart: vi.fn(async (input: { id: string; cwd: string; cols: number; rows: number }) => ({
      ok: true as const,
      id: input.id
    })),
    terminalWrite: vi.fn(async () => ({ ok: true as const })),
    terminalResize: vi.fn(async () => ({ ok: true as const })),
    terminalClose: vi.fn(async () => ({ ok: true as const })),
    onTerminalData: vi.fn((listener: (event: TerminalDataEvent) => void) => {
      dataListeners.add(listener);
      return () => dataListeners.delete(listener);
    }),
    onTerminalExit: vi.fn((listener: (event: TerminalExitEvent) => void) => {
      exitListeners.add(listener);
      return () => exitListeners.delete(listener);
    }),
    emitData(event: TerminalDataEvent) {
      for (const listener of dataListeners) {
        listener(event);
      }
    },
    emitExit(event: TerminalExitEvent) {
      for (const listener of exitListeners) {
        listener(event);
      }
    }
  };
  window.chengxiaobang = bridge;
  return bridge;
}

function previewBuffer(text = "preview"): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

function installPreviewBridge(options: {
  kind?: PreviewKind;
  text?: string;
  buffer?: ArrayBuffer;
  fileUrl?: string;
  thumbnailUrl?: string;
  thumbnailError?: string;
} = {}) {
  const bridge = {
    getBackendInfo: vi.fn(async () => undefined),
    pickDirectory: vi.fn(async () => undefined),
    pickFiles: vi.fn(async () => []),
    readFileText: vi.fn() as never,
    getFilePreviewInfo: vi.fn(async (
      path: string,
      context?: { projectPath?: string; sessionId?: string }
    ) => {
      const resolvedPath = path.startsWith("/")
        ? path
        : context?.projectPath
          ? `${context.projectPath}/${path}`
          : context?.sessionId
            ? `/tmp/${context.sessionId}/${path}`
            : path;
      const kind = options.kind ?? previewKindForPath(path);
      const descriptor = previewDescriptorForKind(kind);
      return {
        ok: true as const,
        path: resolvedPath,
        name: resolvedPath.split(/[\\/]/).pop() ?? resolvedPath,
        size: options.buffer?.byteLength ?? options.text?.length ?? 17,
        extension: extensionOf(resolvedPath),
        kind,
        label: descriptor.label,
        canPreview: descriptor.canPreview
      };
    }),
    readFilePreviewText: vi.fn(async (path: string) => ({
      ok: true as const,
      path,
      name: path.split(/[\\/]/).pop() ?? path,
      text: options.text ?? "line one\nline two",
      size: options.text?.length ?? 17,
      truncated: false
    })),
    readFilePreviewBuffer: vi.fn(async (path: string) => ({
      ok: true as const,
      path,
      name: path.split(/[\\/]/).pop() ?? path,
      data: options.buffer ?? previewBuffer(),
      size: options.buffer?.byteLength ?? 7,
      truncated: false
    })),
    createFileUrl: vi.fn(async (path: string) => ({
      ok: true as const,
      path,
      url: options.fileUrl ?? `file://${encodeURI(path)}`
    })),
    createQuickLookThumbnail: vi.fn(async (path: string) =>
      options.thumbnailUrl
        ? { ok: true as const, path, url: options.thumbnailUrl }
        : { ok: false as const, path, error: options.thumbnailError ?? "没有缩略图" }
    ),
    openPath: vi.fn(async () => ({ ok: true as const }))
  };
  window.chengxiaobang = bridge;
  return bridge;
}

async function expectHtmlArtifactInBrowser(
  bridge: ReturnType<typeof installPreviewBridge>,
  artifactPath = "page.html",
  resolvedPath = "/tmp/demo/page.html",
  fileUrl = "file:///tmp/demo/page.html"
): Promise<void> {
  await waitFor(() => expect(useAppStore.getState().rightPanelMode).toBe("browser"));
  expect(useAppStore.getState().browserUrl).toBe(fileUrl);
  expect(useAppStore.getState().previewFile).toBeUndefined();
  expect(await screen.findByText("浏览器")).toBeInTheDocument();
  await waitFor(() =>
    expect(document.querySelector("webview")?.getAttribute("src")).toBe(fileUrl)
  );
  expect(bridge.getFilePreviewInfo).toHaveBeenCalledWith(artifactPath, {
    projectPath: project.path,
    sessionId: session.id,
    allowCwdFallback: false
  });
  expect(bridge.createFileUrl).toHaveBeenCalledWith(resolvedPath);
}

/** Opens the panel via the toggle and enters a tool page from the menu. */
async function openPane(name: string): Promise<void> {
  const toggle = await screen.findByTitle("打开侧边面板");
  await act(async () => {
    fireEvent.click(toggle);
  });
  const button = await screen.findByRole("button", { name });
  await act(async () => {
    fireEvent.click(button);
  });
}

async function expandProjectFiles(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "展开项目文件" }));
}

async function selectSession(title: string): Promise<void> {
  const sidebar = within(await screen.findByTestId("app-sidebar"));
  const label = await sidebar.findByText(title);
  fireEvent.click(label.closest("button") ?? label);
  await screen.findByTitle("打开侧边面板");
}

async function clickSidebarSession(title: string): Promise<void> {
  const sidebar = within(await screen.findByTestId("app-sidebar"));
  const label = await sidebar.findByText(title);
  await act(async () => {
    fireEvent.click(label.closest("button") ?? label);
  });
}

async function clickArtifactButton(name: string): Promise<void> {
  const matches = await screen.findAllByText(name);
  const button = matches.map((match) => match.closest("button")).find(Boolean);
  fireEvent.click(button ?? matches[0]);
}

function fileTreeIconSvg(path: string): string {
  const button = screen.getByTitle(path);
  const icon = button.querySelector("svg.cxb-svg-icon");
  expect(icon).not.toBeNull();
  return icon?.outerHTML ?? "";
}

function fileTreeGuides(path: string): HTMLElement[] {
  return within(screen.getByTitle(path)).queryAllByTestId("project-file-tree-guide");
}

function todoToolCall(
  id: string,
  name: "TodoWrite",
  args: ToolCall["args"],
  status: ToolCall["status"] = "completed"
): ToolCall {
  return {
    id,
    runId: "run_todo",
    name,
    args,
    status,
    createdAt: `2026-06-13T00:00:0${id.endsWith("2") ? "2" : "1"}.000Z`,
    updatedAt: `2026-06-13T00:00:0${id.endsWith("2") ? "2" : "1"}.000Z`
  };
}

function todoArgs(
  todos: Array<{
    content: string;
    status: "pending" | "in_progress" | "completed";
    priority?: "high" | "medium" | "low";
  }>
): ToolCall["args"] {
  return {
    todos: todos.map((todo) => ({
      content: todo.content,
      status: todo.status,
      priority: todo.priority ?? "medium"
    }))
  };
}

function historicalTodoToolCall(partial: Partial<ToolCall>): ToolCall {
  return {
    id: "todo_history_1",
    runId: "run_history",
    name: "TodoWrite",
    args: todoArgs([{ content: "历史步骤", status: "in_progress" }]),
    status: "completed",
    createdAt: "2026-06-12T00:00:01.000Z",
    updatedAt: "2026-06-12T00:00:01.000Z",
    ...partial
  };
}

describe("right panel", () => {
  it("opens on the menu page, navigates back from a tool and closes", async () => {
    const client = createClient();

    render(<App client={client} />);
    await screen.findByText("项目对话");
    await selectSession("项目对话");

    fireEvent.click(await screen.findByTitle("打开侧边面板"));
    expect(await screen.findByRole("button", { name: "侧边会话" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "产物" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "进度" })).not.toBeInTheDocument();

    installTerminalBridge();
    fireEvent.click(screen.getByRole("button", { name: "终端" }));
    expect(await screen.findByLabelText("终端")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("返回菜单"));
    expect(await screen.findByRole("button", { name: "浏览器" })).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("关闭面板"));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "浏览器" })).not.toBeInTheDocument()
    );
  });

  it("hides the top-right toolbar before opening the right panel", async () => {
    const client = createClient();

    render(<App client={client} />);
    await screen.findByText("项目对话");
    await selectSession("项目对话");

    const toolbar = screen.getByTestId("right-panel-toolbar");
    fireEvent.click(await screen.findByTitle("打开侧边面板"));

    expect(toolbar).toHaveClass("pointer-events-none", "scale-95", "opacity-0");
    expect(useAppStore.getState().rightPanelOpen).toBe(false);
    expect(screen.queryByTestId("right-panel")).not.toBeInTheDocument();

    const panel = await screen.findByTestId("right-panel");
    expect(panel).toHaveAttribute("data-right-panel-phase", "opening");
    expect(useAppStore.getState().rightPanelOpen).toBe(true);
  });

  it("auto-opens the floating progress panel when the active run creates a todo", async () => {
    const client = createClient();
    render(<App client={client} />);
    await screen.findByText("项目对话");
    await selectSession("项目对话");

    act(() => {
      const store = useAppStore.getState();
      store.handleRunEvent(
        { type: "run_started", runId: "run_todo", sessionId: session.id },
        { force: true }
      );
      store.handleRunEvent(
        {
          type: "tool_call",
          runId: "run_todo",
          toolCall: todoToolCall(
            "todo_1",
            "TodoWrite",
            todoArgs([
              { content: "新增契约", status: "in_progress" },
              { content: "接入右侧面板", status: "pending" }
            ]),
            "running"
          )
        },
        { force: true }
      );
      store.handleRunEvent(
        {
          type: "tool_call",
          runId: "run_todo",
          toolCall: todoToolCall(
            "todo_2",
            "TodoWrite",
            todoArgs([
              { content: "共享契约完成", status: "completed" },
              { content: "接入右侧面板", status: "in_progress" }
            ])
          )
        },
        { force: true }
      );
    });

    expect(useAppStore.getState().progressPanelOpen).toBe(true);
    expect(useAppStore.getState().rightPanelOpen).toBe(false);
    expect(useAppStore.getState().rightPanelMode).toBeNull();
    expect(screen.queryByTestId("right-panel")).not.toBeInTheDocument();
    expect(await screen.findByTestId("progress-floating-panel")).toBeInTheDocument();
    expect(screen.getByText("运行中")).toBeInTheDocument();
    expect(screen.getByText("共享契约完成")).toBeInTheDocument();
  });

  it("shows historical todo progress after loading a completed session", async () => {
    const client = createClient({
      listSessionRuns: vi.fn(async () => ({
        runs: [
          {
            id: "run_history",
            sessionId: session.id,
            status: "completed" as const,
            createdAt: "2026-06-12T00:00:00.000Z",
            updatedAt: "2026-06-12T00:00:03.000Z"
          }
        ],
        toolCalls: [
          historicalTodoToolCall({
            id: "todo_history_1",
            args: todoArgs([
              { content: "读取项目结构", status: "in_progress" },
              { content: "生成总结", status: "pending" }
            ])
          }),
          historicalTodoToolCall({
            id: "todo_history_2",
            name: "TodoWrite",
            args: todoArgs([
              { content: "项目结构读取完成", status: "completed" },
              { content: "生成总结", status: "in_progress" }
            ]),
            createdAt: "2026-06-12T00:00:02.000Z",
            updatedAt: "2026-06-12T00:00:02.000Z"
          })
        ]
      }))
    });

    render(<App client={client} />);
    await selectSession("项目对话");

    expect(useAppStore.getState().progressPanelOpen).toBe(false);
    expect(await screen.findByTestId("progress-floating-panel")).toBeInTheDocument();
    expect(screen.getByText("最近清单")).toBeInTheDocument();
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    expect(screen.getByText("项目结构读取完成")).toBeInTheDocument();
  });

  it("keeps completed historical todo progress visible", async () => {
    const client = createClient({
      listSessionRuns: vi.fn(async () => ({
        runs: [
          {
            id: "run_history",
            sessionId: session.id,
            status: "completed" as const,
            createdAt: "2026-06-12T00:00:00.000Z",
            updatedAt: "2026-06-12T00:00:03.000Z"
          }
        ],
        toolCalls: [
          historicalTodoToolCall({
            id: "todo_done_1",
            args: todoArgs([{ content: "完成页面", status: "in_progress" }])
          }),
          historicalTodoToolCall({
            id: "todo_done_2",
            name: "TodoWrite",
            args: todoArgs([{ content: "页面已完成", status: "completed" }]),
            createdAt: "2026-06-12T00:00:02.000Z",
            updatedAt: "2026-06-12T00:00:02.000Z"
          })
        ]
      }))
    });

    render(<App client={client} />);
    await selectSession("项目对话");

    expect(await screen.findByTestId("progress-floating-panel")).toBeInTheDocument();
    expect(screen.getByText("最近清单")).toBeInTheDocument();
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
    expect(screen.getByText("页面已完成")).toBeInTheDocument();
  });

  it("collapses and expands the completed todo group", async () => {
    const client = createClient();
    render(<App client={client} />);
    await screen.findByText("项目对话");
    await selectSession("项目对话");

    act(() => {
      const store = useAppStore.getState();
      store.handleRunEvent(
        { type: "run_started", runId: "run_todo", sessionId: session.id },
        { force: true }
      );
      store.handleRunEvent(
        {
          type: "tool_call",
          runId: "run_todo",
          toolCall: todoToolCall(
            "todo_1",
            "TodoWrite",
            todoArgs([
              { content: "共享契约完成", status: "completed" },
              { content: "接入右侧面板", status: "in_progress" }
            ])
          )
        },
        { force: true }
      );
    });

    expect(await screen.findByTestId("progress-floating-panel")).toBeInTheDocument();
    const toggle = screen.getByText("已完成 1 项").closest("button") as HTMLButtonElement;
    // 默认展开：已完成项可见。
    expect(screen.getByText("共享契约完成")).toBeInTheDocument();
    // 收起后已完成项隐藏，进行中项仍在。
    fireEvent.click(toggle);
    expect(screen.queryByText("共享契约完成")).not.toBeInTheDocument();
    expect(screen.getByText("接入右侧面板")).toBeInTheDocument();
    // 再次展开恢复。
    fireEvent.click(toggle);
    expect(screen.getByText("共享契约完成")).toBeInTheDocument();
  });

  it("shows an all-done footer when the active run finishes its todo", async () => {
    const client = createClient();
    render(<App client={client} />);
    await screen.findByText("项目对话");
    await selectSession("项目对话");

    act(() => {
      const store = useAppStore.getState();
      store.handleRunEvent(
        { type: "run_started", runId: "run_todo", sessionId: session.id },
        { force: true }
      );
      store.handleRunEvent(
        {
          type: "tool_call",
          runId: "run_todo",
          toolCall: todoToolCall(
            "todo_1",
            "TodoWrite",
            todoArgs([{ content: "全部搞定", status: "completed" }])
          )
        },
        { force: true }
      );
    });

    expect(await screen.findByTestId("progress-floating-panel")).toBeInTheDocument();
    expect(screen.getByText("全部完成")).toBeInTheDocument();
    expect(screen.getByText("已完成 1 / 1")).toBeInTheDocument();
  });

  it("treats the latest empty TodoWrite snapshot as cleared progress", async () => {
    const client = createClient({
      listSessionRuns: vi.fn(async () => ({
        runs: [
          {
            id: "run_history",
            sessionId: session.id,
            status: "completed" as const,
            createdAt: "2026-06-12T00:00:00.000Z",
            updatedAt: "2026-06-12T00:00:03.000Z"
          }
        ],
        toolCalls: [
          historicalTodoToolCall({
            id: "todo_old",
            args: todoArgs([{ content: "旧清单", status: "in_progress" }])
          }),
          historicalTodoToolCall({
            id: "todo_clear",
            name: "TodoWrite",
            args: todoArgs([]),
            createdAt: "2026-06-12T00:00:02.000Z",
            updatedAt: "2026-06-12T00:00:02.000Z"
          })
        ]
      }))
    });

    render(<App client={client} />);
    await selectSession("项目对话");

    await waitFor(() =>
      expect(screen.queryByTestId("progress-floating-panel")).not.toBeInTheDocument()
    );
    expect(screen.queryByText("旧清单")).not.toBeInTheDocument();
  });

  it("does not auto-open progress for an empty TodoWrite snapshot", async () => {
    const client = createClient();
    render(<App client={client} />);
    await screen.findByText("项目对话");
    await selectSession("项目对话");

    act(() => {
      const store = useAppStore.getState();
      store.handleRunEvent(
        { type: "run_started", runId: "run_todo", sessionId: session.id },
        { force: true }
      );
      store.handleRunEvent(
        {
          type: "tool_call",
          runId: "run_todo",
          toolCall: todoToolCall("todo_clear", "TodoWrite", todoArgs([]))
        },
        { force: true }
      );
    });

    expect(useAppStore.getState().progressPanelOpen).toBe(false);
    expect(screen.queryByTestId("progress-floating-panel")).not.toBeInTheDocument();
  });

  it("closes the floating progress state when a running todo is cleared", async () => {
    const client = createClient();
    render(<App client={client} />);
    await screen.findByText("项目对话");
    await selectSession("项目对话");

    act(() => {
      const store = useAppStore.getState();
      store.handleRunEvent(
        { type: "run_started", runId: "run_todo", sessionId: session.id },
        { force: true }
      );
      store.handleRunEvent(
        {
          type: "tool_call",
          runId: "run_todo",
          toolCall: todoToolCall(
            "todo_1",
            "TodoWrite",
            todoArgs([{ content: "执行中", status: "in_progress" }])
          )
        },
        { force: true }
      );
    });

    expect(await screen.findByTestId("progress-floating-panel")).toBeInTheDocument();
    expect(useAppStore.getState().progressPanelOpen).toBe(true);

    act(() => {
      useAppStore.getState().handleRunEvent(
        {
          type: "tool_call",
          runId: "run_todo",
          toolCall: todoToolCall("todo_clear", "TodoWrite", todoArgs([]))
        },
        { force: true }
      );
    });

    expect(useAppStore.getState().progressPanelOpen).toBe(false);
    expect(screen.queryByTestId("progress-floating-panel")).not.toBeInTheDocument();
  });

  it("hides historical progress after switching to a session without todo history", async () => {
    const client = createClient({
      listSessions: vi.fn(async () => [session, secondSession]),
      listSessionRuns: vi.fn(async (sessionId: string) =>
        sessionId === session.id
          ? {
              runs: [
                {
                  id: "run_history",
                  sessionId: session.id,
                  status: "completed" as const,
                  createdAt: "2026-06-12T00:00:00.000Z",
                  updatedAt: "2026-06-12T00:00:03.000Z"
                }
              ],
              toolCalls: [historicalTodoToolCall({})]
            }
          : { runs: [], toolCalls: [] }
      )
    });

    render(<App client={client} />);
    await selectSession("项目对话");
    expect(await screen.findByTestId("progress-floating-panel")).toBeInTheDocument();

    await selectSession("另一个项目对话");

    await waitFor(() =>
      expect(screen.queryByTestId("progress-floating-panel")).not.toBeInTheDocument()
    );
  });

  it("does not show stale historical progress while a new run has no todo yet", async () => {
    const client = createClient({
      listSessionRuns: vi.fn(async () => ({
        runs: [
          {
            id: "run_history",
            sessionId: session.id,
            status: "completed" as const,
            createdAt: "2026-06-12T00:00:00.000Z",
            updatedAt: "2026-06-12T00:00:03.000Z"
          }
        ],
        toolCalls: [historicalTodoToolCall({})]
      }))
    });

    render(<App client={client} />);
    await selectSession("项目对话");
    expect(await screen.findByText("历史步骤")).toBeInTheDocument();

    act(() => {
      useAppStore
        .getState()
        .handleRunEvent({ type: "run_started", runId: "run_todo", sessionId: session.id }, { force: true });
    });

    await waitFor(() =>
      expect(screen.queryByTestId("progress-floating-panel")).not.toBeInTheDocument()
    );

    act(() => {
      useAppStore.getState().handleRunEvent(
        {
          type: "tool_call",
          runId: "run_todo",
          toolCall: todoToolCall(
            "todo_1",
            "TodoWrite",
            todoArgs([{ content: "开始执行", status: "in_progress" }])
          )
        },
        { force: true }
      );
    });

    expect(await screen.findByTestId("progress-floating-panel")).toBeInTheDocument();
    expect(screen.getByText("运行中")).toBeInTheDocument();
    expect(screen.getByText("开始执行")).toBeInTheDocument();
  });

  it("keeps progress updates in the floating panel without opening the right panel", async () => {
    const client = createClient();
    render(<App client={client} />);
    await screen.findByText("项目对话");
    await selectSession("项目对话");

    act(() => {
      const store = useAppStore.getState();
      store.setRightPanelWidth(360);
      store.handleRunEvent(
        { type: "run_started", runId: "run_todo", sessionId: session.id },
        { force: true }
      );
      store.handleRunEvent(
        {
          type: "tool_call",
          runId: "run_todo",
          toolCall: todoToolCall(
            "todo_1",
            "TodoWrite",
            todoArgs([
              { content: "预留滚动条空间并约束长文本", status: "in_progress" },
              { content: "等待下一步执行", status: "pending" }
            ])
          )
        },
        { force: true }
      );
    });

    const panel = await screen.findByTestId("progress-floating-panel");
    const scrollRegion = await screen.findByTestId("progress-floating-scroll");

    expect(useAppStore.getState().progressPanelOpen).toBe(true);
    expect(useAppStore.getState().rightPanelOpen).toBe(false);
    expect(screen.queryByTestId("right-panel")).not.toBeInTheDocument();
    expect(panel).toHaveClass("chat-progress-floating", "bg-card");
    expect(panel).not.toHaveClass("shadow-stack", "shadow-overlay", "backdrop-blur-sm", "bg-card/95");
    expect(scrollRegion).toHaveClass("overflow-x-hidden", "[scrollbar-gutter:stable]");
    expect(screen.getByLabelText("进行中")).toHaveClass("animate-spin", "text-link");
    expect(screen.getByText("等待下一步执行")).toHaveClass(
      "text-body-xs",
      "[color:rgb(var(--muted-foreground))]"
    );
    expect(screen.getByText("等待下一步执行")).not.toHaveClass("text-body");

    act(() => {
      const store = useAppStore.getState();
      store.handleRunEvent(
        {
          type: "tool_call",
          runId: "run_todo",
          toolCall: todoToolCall(
            "todo_2",
            "TodoWrite",
            todoArgs([
              {
                content: "这是一段较长的流式进度说明，用来模拟更新进入面板时的内容增长。".repeat(
                  5
                ),
                status: "completed"
              }
            ])
          )
        },
        { force: true }
      );
      store.handleRunEvent(
        { type: "delta", runId: "run_todo", channel: "text", delta: "继续输出中..." },
        { force: true }
      );
    });

    expect(useAppStore.getState().rightPanelWidth).toBe(360);
    expect(useAppStore.getState().rightPanelOpen).toBe(false);
    expect(screen.getByTestId("progress-floating-panel")).toBeInTheDocument();
  });

  it("opens file preview at a stable right-panel width while progress stays floating", async () => {
    installPreviewBridge({ kind: "code", text: "line one\nline two" });
    const client = createClient();
    render(<App client={client} />);
    await screen.findByText("项目对话");
    await selectSession("项目对话");

    act(() => {
      const store = useAppStore.getState();
      store.setRightPanelWidth(360);
      store.handleRunEvent(
        { type: "run_started", runId: "run_todo", sessionId: session.id },
        { force: true }
      );
      store.handleRunEvent(
        {
          type: "tool_call",
          runId: "run_todo",
          toolCall: todoToolCall(
            "todo_1",
            "TodoWrite",
            todoArgs([{ content: "保持进度浮层", status: "in_progress" }])
          )
        },
        { force: true }
      );
    });

    const stack = await screen.findByTestId("chat-floating-stack");
    expect(await within(stack).findByTestId("progress-floating-panel")).toBeInTheDocument();
    expect(useAppStore.getState().rightPanelOpen).toBe(false);

    act(() => {
      useAppStore.getState().openFilePreview("src/a.ts");
    });

    const panel = screen.getByTestId("right-panel");
    const layoutScope = screen.getByTestId("chat-layout-scope");
    const content = screen.getByTestId("right-panel-content");

    expect(useAppStore.getState().progressPanelOpen).toBe(true);
    expect(useAppStore.getState().rightPanelOpen).toBe(true);
    expect(useAppStore.getState().rightPanelMode).toBe("files");
    expect(useAppStore.getState().rightPanelWidth).toBe(RIGHT_PANEL_FILE_WIDTH);
    expect(layoutScope).toHaveAttribute("data-right-panel-open", "true");
    expect(layoutScope).toHaveAttribute("data-right-panel-phase", "opening");
    expect(layoutScope).toHaveAttribute("data-right-panel-reserved", "true");
    expect(layoutScope).toHaveAttribute("data-right-panel-mode", "files");
    expect(panel).toHaveAttribute("data-right-panel-phase", "opening");
    expect(content).toHaveClass("right-panel-content-enter");
    expect(content).toHaveClass("border-l", "border-border");
    expect(panel.getAttribute("class") ?? "").not.toContain("box-shadow");
    const panelStyle = panel.getAttribute("style") ?? "";
    expect(panelStyle).toContain(`--right-panel-width: ${RIGHT_PANEL_FILE_WIDTH}px`);
    expect(panelStyle).not.toContain("width: 0px");
    expect(within(stack).getByTestId("progress-floating-panel")).toBeInTheDocument();
    expect(await screen.findByText("a.ts")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("关闭面板"));

    expect(useAppStore.getState().rightPanelOpen).toBe(false);
    expect(layoutScope).toHaveAttribute("data-right-panel-open", "false");
    expect(layoutScope).toHaveAttribute("data-right-panel-phase", "closing");
    expect(layoutScope).toHaveAttribute("data-right-panel-reserved", "true");
    expect(panel).toHaveAttribute("data-right-panel-phase", "closing");
    expect(content).toHaveClass("right-panel-content-exit");
    expect(panel.getAttribute("style") ?? "").not.toContain("width: 0px");

    await waitFor(() => expect(layoutScope).toHaveAttribute("data-right-panel-phase", "closed"));
    expect(layoutScope).toHaveAttribute("data-right-panel-reserved", "false");
    expect(screen.queryByTestId("right-panel")).not.toBeInTheDocument();
  });

  it("keeps the floating progress panel open without exposing a close control", async () => {
    const client = createClient();
    render(<App client={client} />);
    await screen.findByText("项目对话");
    await selectSession("项目对话");

    act(() => {
      const store = useAppStore.getState();
      store.handleRunEvent(
        { type: "run_started", runId: "run_todo", sessionId: session.id },
        { force: true }
      );
      store.handleRunEvent(
        {
          type: "tool_call",
          runId: "run_todo",
          toolCall: todoToolCall(
            "todo_1",
            "TodoWrite",
            todoArgs([{ content: "新增契约", status: "in_progress" }])
          )
        },
        { force: true }
      );
    });
    expect(await screen.findByText("新增契约")).toBeInTheDocument();
    expect(screen.getByTestId("progress-floating-panel")).toHaveClass("rounded-xl");
    expect(screen.queryByTitle("关闭进度")).not.toBeInTheDocument();

    act(() => {
      useAppStore.getState().handleRunEvent(
        {
          type: "tool_call",
          runId: "run_todo",
          toolCall: todoToolCall(
            "todo_2",
            "TodoWrite",
            todoArgs([{ content: "继续执行", status: "in_progress" }])
          )
        },
        { force: true }
      );
    });

    expect(useAppStore.getState().rightPanelOpen).toBe(false);
    expect(useAppStore.getState().progressPanelOpen).toBe(true);
    expect(await screen.findByText("继续执行")).toBeInTheDocument();
  });

  it("keeps the right panel tools available while the floating progress panel is open", async () => {
    const client = createClient();
    render(<App client={client} />);
    await screen.findByText("项目对话");
    await selectSession("项目对话");

    act(() => {
      const store = useAppStore.getState();
      store.handleRunEvent(
        { type: "run_started", runId: "run_todo", sessionId: session.id },
        { force: true }
      );
      store.handleRunEvent(
        {
          type: "tool_call",
          runId: "run_todo",
          toolCall: todoToolCall(
            "todo_1",
            "TodoWrite",
            todoArgs([{ content: "保持工具入口可用", status: "in_progress" }])
          )
        },
        { force: true }
      );
    });

    expect(await screen.findByTestId("progress-floating-panel")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("打开侧边面板"));

    expect(await screen.findByRole("button", { name: "浏览器" })).toBeInTheDocument();
    expect(useAppStore.getState().progressPanelOpen).toBe(true);
    expect(useAppStore.getState().rightPanelOpen).toBe(true);
  });

  it("starts a pty terminal in the active project and streams data through the bridge", async () => {
    const bridge = installTerminalBridge();
    const client = createClient();
    setTerminalThemeTokens({
      ...LIGHT_TERMINAL_THEME_TOKENS,
      "--canvas": "252 253 254",
      "--ink": "24 25 26",
      "--link": "1 113 244",
      "--link-bg-soft": "210 228 254",
      "--soft-blue": "65 119 191"
    });

    render(<App client={client} />);
    await screen.findByText("项目对话");
    await selectSession("项目对话");

    await openPane("终端");
    const terminal = await screen.findByLabelText("终端");
    await waitFor(() => expect(bridge.terminalStart).toHaveBeenCalled());
    const startInput = bridge.terminalStart.mock.calls[0][0];
    expect(startInput).toMatchObject({ cwd: "/tmp/demo", cols: 100, rows: 30 });
    const terminalInstance = terminalMock.MockTerminal.instances[0];
    expect(terminalInstance.initialOptions.theme).toMatchObject({
      background: "rgb(252, 253, 254)",
      foreground: "rgb(24, 25, 26)",
      cursor: "rgb(65, 119, 191)",
      selectionBackground: "rgba(210, 228, 254, 0.72)",
      blue: "rgb(1, 113, 244)"
    });
    expect(terminalInstance.initialOptions.theme?.background).not.toBe("#171717");
    expect(terminalInstance.initialOptions.theme?.background).not.toBe("#000");

    setTerminalThemeTokens(DARK_TERMINAL_THEME_TOKENS);
    document.documentElement.classList.add("dark");
    await waitFor(() => {
      expect(terminalInstance.themeAssignments.at(-1)).toMatchObject({
        background: "rgb(18, 18, 18)",
        foreground: "rgb(250, 250, 250)",
        cursor: "rgb(82, 168, 255)",
        blue: "rgb(82, 168, 255)"
      });
    });

    bridge.emitData({ id: startInput.id, data: "hello.txt\r\n" });
    expect(terminal).toHaveTextContent("hello.txt");

    terminalMock.MockTerminal.instances[0].emitData("ls\r");
    expect(bridge.terminalWrite).toHaveBeenCalledWith(startInput.id, "ls\r");

    bridge.emitExit({ id: startInput.id, exitCode: 2 });
    expect(terminal).toHaveTextContent("终端已退出（退出码 2）");
  });

  it("hides project-only tools in conversation sessions", async () => {
    const client = createClient({
      listProjects: vi.fn(async () => [project]),
      listSessions: vi.fn(async () => [conversationSession])
    });

    render(<App client={client} />);
    await screen.findByText("纯对话");
    await selectSession("纯对话");

    fireEvent.click(await screen.findByTitle("打开侧边面板"));

    expect(await screen.findByRole("button", { name: "浏览器" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "侧边会话" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "产物" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "进度" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "终端" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "文件预览" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "审查" })).not.toBeInTheDocument();
  });

  it("hides changes for a non-git project but keeps project tools", async () => {
    const getGitInfo = vi.fn(async () => ({ isRepo: false }));
    const client = createClient({ getGitInfo });

    render(<App client={client} />);
    await screen.findByText("项目对话");
    await selectSession("项目对话");

    fireEvent.click(await screen.findByTitle("打开侧边面板"));

    expect(await screen.findByRole("button", { name: "终端" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "文件预览" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "浏览器" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "侧边会话" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "产物" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "进度" })).not.toBeInTheDocument();
    await waitFor(() => expect(getGitInfo).toHaveBeenCalledWith(project.id));
    expect(screen.queryByRole("button", { name: "审查" })).not.toBeInTheDocument();
  });

  it("does not fall back from changes while git availability is still pending", async () => {
    const gitInfoResolvers: Array<(value: { isRepo: boolean }) => void> = [];
    const getGitInfo = vi.fn(
      () =>
        new Promise<{ isRepo: boolean }>((resolve) => {
          gitInfoResolvers.push(resolve);
        })
    );
    const client = createClient({ getGitInfo });

    render(<App client={client} />);
    await screen.findByText("项目对话");
    await selectSession("项目对话");

    act(() => {
      useAppStore.getState().openRightPanel("changes");
    });

    expect(await screen.findByText("审查")).toBeInTheDocument();
    expect(useAppStore.getState().rightPanelMode).toBe("changes");
    await waitFor(() => expect(getGitInfo).toHaveBeenCalledWith(project.id));
    expect(useAppStore.getState().rightPanelMode).toBe("changes");

    await act(async () => {
      for (const resolve of gitInfoResolvers) {
        resolve({ isRepo: false });
      }
    });

    await waitFor(() => expect(useAppStore.getState().rightPanelMode).toBeNull());
    expect(await screen.findByRole("button", { name: "浏览器" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "审查" })).not.toBeInTheDocument();
  });

  it("lists active project files in the file preview panel and opens them with project context", async () => {
    const bridge = installPreviewBridge({ kind: "code", text: "line one\nline two" });
    const rootEntries: ProjectFileEntry[] = [
      { name: "src", path: "src", type: "directory" },
      { name: ".eslintrc.js", path: ".eslintrc.js", type: "file" },
      { name: "package.json", path: "package.json", type: "file" },
      { name: "README.md", path: "README.md", type: "file" }
    ];
    const srcEntries: ProjectFileEntry[] = [
      { name: "components", path: "src/components", type: "directory" },
      { name: "app.js", path: "src/app.js", type: "file" }
    ];
    const componentEntries: ProjectFileEntry[] = [
      { name: "Button.tsx", path: "src/components/Button.tsx", type: "file" }
    ];
    const listProjectDirectory = vi.fn(async (projectId: string, path = ".") => {
      if (projectId !== project.id) {
        return [];
      }
      if (path === ".") {
        return rootEntries;
      }
      if (path === "src") {
        return srcEntries;
      }
      if (path === "src/components") {
        return componentEntries;
      }
      return [];
    });
    const client = createClient({ listProjectDirectory });

    render(<App client={client} />);
    await screen.findByText("项目对话");
    await selectSession("项目对话");
    await openPane("文件预览");

    expect(screen.getByRole("button", { name: "展开项目文件" })).toBeInTheDocument();
    expect(screen.queryByText("项目文件")).not.toBeInTheDocument();
    expect(screen.queryByText("README.md")).not.toBeInTheDocument();
    expect(listProjectDirectory).not.toHaveBeenCalled();

    await expandProjectFiles();
    expect(await screen.findByText("项目文件")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /选择文件|rightPanel\.pickFile/u })).not.toBeInTheDocument();
    expect(bridge.pickFiles).not.toHaveBeenCalled();
    expect(await screen.findByText("README.md")).toBeInTheDocument();
    expect(listProjectDirectory).toHaveBeenCalledWith(project.id, ".");
    expect(screen.getByTitle("src")).toHaveClass("h-7");
    expect(screen.getByTitle("src").querySelector("img")).toBeNull();
    expect(fileTreeIconSvg(".eslintrc.js")).toContain("#693acf");
    expect(fileTreeIconSvg("package.json")).toContain("#d52c36");

    fireEvent.click(screen.getByTitle("src"));
    expect(await screen.findByText("app.js")).toBeInTheDocument();
    expect(fileTreeGuides("src/app.js")).toHaveLength(1);
    fireEvent.click(screen.getByTitle("src/components"));
    expect(await screen.findByText("Button.tsx")).toBeInTheDocument();
    expect(screen.getByTitle("src/components").querySelector("img")).toBeNull();
    expect(fileTreeGuides("src/components/Button.tsx")).toHaveLength(2);

    fireEvent.click(screen.getByText("README.md"));

    expect(await screen.findByText("line two")).toBeInTheDocument();
    expect(bridge.getFilePreviewInfo).toHaveBeenCalledWith("README.md", {
      projectPath: project.path,
      sessionId: session.id
    });
    expect(bridge.readFilePreviewText).toHaveBeenCalledWith("/tmp/demo/README.md", {
      maxBytes: 524288
    });
  });

  it("highlights JavaScript project files in the file preview panel", async () => {
    const jsText = "const value = 1;\nconsole.log(value);";
    installPreviewBridge({ kind: "code", text: jsText });
    useAppStore.setState({
      codePreviewSettings: {
        ...DEFAULT_CODE_PREVIEW_SETTINGS,
        darkTheme: "github-dark-high-contrast",
        fontSize: 14,
        lightTheme: "github-light-high-contrast",
        wrapLongLines: true
      }
    });
    const listProjectDirectory = vi.fn(async () => [
      { name: "app.js", path: "src/app.js", type: "file" } satisfies ProjectFileEntry
    ]);
    const client = createClient({ listProjectDirectory });

    render(<App client={client} />);
    await screen.findByText("项目对话");
    await selectSession("项目对话");
    await openPane("文件预览");

    await expandProjectFiles();
    fireEvent.click(await screen.findByText("app.js"));

    const preview = await screen.findByTestId("file-code-preview");
    await waitFor(() =>
      expect(shikiMock.codeToTokensWithThemes).toHaveBeenCalledWith(jsText, {
        lang: "javascript",
        themes: { light: "github-light-high-contrast", dark: "github-dark-high-contrast" }
      })
    );
    expect(preview).toHaveAttribute("data-language", "javascript");
    expect(preview).toHaveAttribute("data-code-line-numbers", "true");
    expect(preview).toHaveAttribute("data-code-font-size", "14");
    expect(preview.getAttribute("style")).toContain("font-size: 14px");
    expect(preview.querySelector("[data-code-wrap]")).toHaveAttribute("data-code-wrap", "true");
    expect(preview.querySelector(".cxb-code-line-number")).toHaveTextContent("1");
    expect(preview.querySelector('[data-streamdown="code-block"]')).toBeNull();
    expect(within(preview).getByText("const value = 1;")).toHaveClass("cxb-shiki-token");
    expect(preview).toHaveTextContent("const value = 1;");
    expect(within(preview).getByRole("button", { name: "关闭自动换行" })).toBeInTheDocument();
    expect(within(preview).getByLabelText("复制文件内容")).toBeInTheDocument();
  });

  it("keeps markdown-like JavaScript content as code in the file preview panel", async () => {
    const jsText = 'const heading = "# 标题";\nconst fence = "```js";';
    installPreviewBridge({ kind: "code", text: jsText });
    const listProjectDirectory = vi.fn(async () => [
      { name: "markdownish.js", path: "markdownish.js", type: "file" } satisfies ProjectFileEntry
    ]);
    const client = createClient({ listProjectDirectory });

    render(<App client={client} />);
    await screen.findByText("项目对话");
    await selectSession("项目对话");
    await openPane("文件预览");

    await expandProjectFiles();
    fireEvent.click(await screen.findByText("markdownish.js"));

    const preview = await screen.findByTestId("file-code-preview");
    await waitFor(() => expect(shikiMock.codeToTokensWithThemes).toHaveBeenCalled());
    expect(within(preview).getByText('const heading = "# 标题";')).toBeInTheDocument();
    expect(within(preview).getByText('const fence = "```js";')).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "标题" })).not.toBeInTheDocument();
  });

  it("lists final XML artifacts in the floating artifact panel and opens HTML in the browser", async () => {
    const bridge = installPreviewBridge({
      kind: "html",
      fileUrl: "file:///tmp/demo/page.html"
    });
    const client = createClient({
      listMessages: vi.fn(async () => [
        artifactMessage("page.html", {
          id: "artifact_1",
          createdAt: "2026-06-08T00:00:01.000Z"
        }),
        artifactMessage("reports/summary.docx", {
          id: "artifact_2",
          createdAt: "2026-06-08T00:00:02.000Z"
        }),
        artifactMessage("page.html", {
          id: "artifact_3",
          createdAt: "2026-06-08T00:00:03.000Z"
        })
      ])
    });

    render(<App client={client} />);
    await selectSession("项目对话");

    const panel = await screen.findByTestId("artifact-floating-panel");
    expect(screen.queryByTestId("right-panel")).not.toBeInTheDocument();
    expect(within(panel).getByText("2 个产物")).toBeInTheDocument();
    const artifactButtons = within(panel).getAllByRole("button");
    expect(artifactButtons[0]).toHaveTextContent("page.html");
    expect(artifactButtons[1]).toHaveTextContent("summary.docx");

    fireEvent.click(within(panel).getByRole("button", { name: /page\.html/u }));

    await expectHtmlArtifactInBrowser(bridge);
  });

  it("lists declared markdown artifacts in the floating artifact panel", async () => {
    const bridge = installPreviewBridge({
      kind: "markdown",
      text: "# 日报\n\n正文"
    });
    const client = createClient({
      listMessages: vi.fn(async () => [artifactMessage("AI日报_2026-06-13.md")])
    });

    render(<App client={client} />);
    await selectSession("项目对话");

    const panel = await screen.findByTestId("artifact-floating-panel");
    expect(within(panel).getByText("1 个产物")).toBeInTheDocument();
    const artifactButton = within(panel).getByRole("button", {
      name: /AI日报_2026-06-13\.md/u
    });

    fireEvent.click(artifactButton);

    expect(await screen.findByText("正文")).toBeInTheDocument();
    expect(bridge.getFilePreviewInfo).toHaveBeenCalledWith("AI日报_2026-06-13.md", {
      projectPath: project.path,
      sessionId: session.id,
      allowCwdFallback: false
    });
    expect(bridge.readFilePreviewText).toHaveBeenCalledWith(
      "/tmp/demo/AI日报_2026-06-13.md",
      {
        maxBytes: 524288
      }
    );
  });

  it("uses the updated PowerPoint icon in the floating artifact panel", async () => {
    const client = createClient({
      listMessages: vi.fn(async () => [artifactMessage("slides/demo.pptx")])
    });

    render(<App client={client} />);
    await selectSession("项目对话");

    const panel = await screen.findByTestId("artifact-floating-panel");
    const artifactButton = within(panel).getByRole("button", { name: /demo\.pptx/u });

    expect(artifactButton.querySelector("svg")?.outerHTML).toContain("cxb-powerpoint-file-red");
  });

  it("restores Write HTML tool artifacts in the floating artifact panel", async () => {
    const bridge = installPreviewBridge({
      kind: "html",
      fileUrl: "file:///tmp/demo/page.html"
    });
    const client = createClient({
      listMessages: vi.fn(async () => []),
      listSessionRuns: vi.fn(async () => ({
        runs: [],
        toolCalls: [
          {
            id: "tool_html",
            runId: "run_html",
            name: "Write",
            args: { file_path: "page.html", content: "<!doctype html>" },
            status: "completed",
            createdAt: "2026-06-08T00:00:01.000Z",
            updatedAt: "2026-06-08T00:00:02.000Z"
          },
          {
            id: "tool_code",
            runId: "run_code",
            name: "Write",
            args: { file_path: "src/App.tsx", content: "export {}" },
            status: "completed",
            createdAt: "2026-06-08T00:00:03.000Z",
            updatedAt: "2026-06-08T00:00:04.000Z"
          }
        ] satisfies ToolCall[]
      }))
    });

    render(<App client={client} />);
    await selectSession("项目对话");

    const panel = await screen.findByTestId("artifact-floating-panel");
    expect(within(panel).getByText("1 个产物")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /page\.html/u })).toBeInTheDocument();
    expect(within(panel).queryByText("App.tsx")).not.toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: /page\.html/u }));

    await expectHtmlArtifactInBrowser(bridge);
  });

  it("shows artifact floating panel above the progress floating panel", async () => {
    const client = createClient({
      listMessages: vi.fn(async () => [artifactMessage("page.html")])
    });

    render(<App client={client} />);
    await selectSession("项目对话");

    act(() => {
      const store = useAppStore.getState();
      store.handleRunEvent(
        { type: "run_started", runId: "run_todo", sessionId: session.id },
        { force: true }
      );
      store.handleRunEvent(
        {
          type: "tool_call",
          runId: "run_todo",
          toolCall: todoToolCall(
            "todo_1",
            "TodoWrite",
            todoArgs([{ content: "生成页面", status: "in_progress" }])
          )
        },
        { force: true }
      );
    });

    const stack = await screen.findByTestId("chat-floating-stack");
    const artifactPanel = await within(stack).findByTestId("artifact-floating-panel");
    const progressPanel = await within(stack).findByTestId("progress-floating-panel");

    expect([...stack.children]).toEqual([artifactPanel, progressPanel]);
  });

  it("shows changes for a git project", async () => {
    const getGitInfo = vi.fn(async () => ({ isRepo: true }));
    const client = createClient({ getGitInfo });

    render(<App client={client} />);
    await screen.findByText("项目对话");
    await selectSession("项目对话");

    fireEvent.click(await screen.findByTitle("打开侧边面板"));

    expect(await screen.findByRole("button", { name: "审查" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "终端" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "文件预览" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "产物" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "进度" })).not.toBeInTheDocument();
  });

  it("opens a collapsed review list without a persistent project file tree", async () => {
    const getGitInfo = vi.fn(async () => ({ isRepo: true }));
    const getGitChanges = vi.fn(async () => ({
      isRepo: true,
      files: [
        {
          path: "src/a.ts",
          status: " M",
          diff: [
            "diff --git a/src/a.ts b/src/a.ts",
            "--- a/src/a.ts",
            "+++ b/src/a.ts",
            "@@ -1 +1 @@",
            "-old line",
            "+new line"
          ].join("\n")
        },
        {
          path: "README.md",
          status: "??",
          diff: [
            "diff --git a/README.md b/README.md",
            "new file mode 100644",
            "--- /dev/null",
            "+++ b/README.md",
            "@@ -0,0 +1 @@",
            "+intro"
          ].join("\n")
        }
      ]
    }));
    const listProjectDirectory = vi.fn(async () => [] satisfies ProjectFileEntry[]);
    const client = createClient({ getGitInfo, getGitChanges, listProjectDirectory });

    render(<App client={client} />);
    await screen.findByText("项目对话");
    await selectSession("项目对话");
    await openPane("审查");

    const changedFile = await screen.findByText("a.ts");
    expect(changedFile).toBeInTheDocument();
    expect(screen.queryByText("src/a.ts")).not.toBeInTheDocument();
    expect(screen.getByTitle("src/a.ts")).toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.getAllByText("-1").length).toBeGreaterThan(0);
    expect(screen.queryByText("new line")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("筛选文件…")).not.toBeInTheDocument();
    expect(listProjectDirectory).not.toHaveBeenCalled();

    fireEvent.click(changedFile);
    const diff = await screen.findByLabelText("变更对比");
    expect(diff).toHaveTextContent("new line");
    expect(diff).toHaveTextContent("old line");
  });

  it("returns to the menu when switching from a project-only panel to a conversation", async () => {
    installTerminalBridge();
    const client = createClient({
      listSessions: vi.fn(async () => [session, conversationSession])
    });

    render(<App client={client} />);
    await screen.findByText("项目对话");
    await selectSession("项目对话");
    await openPane("终端");
    expect(await screen.findByLabelText("终端")).toBeInTheDocument();

    await clickSidebarSession("纯对话");

    await waitFor(() => expect(screen.queryByLabelText("终端")).not.toBeInTheDocument());
    expect(await screen.findByRole("button", { name: "浏览器" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "侧边会话" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "产物" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "终端" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "文件预览" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "审查" })).not.toBeInTheDocument();
  });

  it("hides the panel toggle on the home view", async () => {
    const client = createClient({
      listProjects: vi.fn(async () => []),
      listSessions: vi.fn(async () => [])
    });

    render(<App client={client} />);
    // The home starters render once the home view is up.
    await screen.findByText("做一份 PPT");

    expect(screen.queryByTitle("打开侧边面板")).not.toBeInTheDocument();
  });

  it("opens the file preview from a tool call's path chip", async () => {
    const bridge = installPreviewBridge({ kind: "code", text: "line one\nline two" });
    const toolCall: ToolCall = {
      id: "tool_1",
      runId: "run_1",
      name: "Read",
      args: { file_path: "src/a.ts" },
      status: "completed",
      result: "line one\nline two",
      createdAt: "2026-06-08T00:00:01.000Z",
      updatedAt: "2026-06-08T00:00:01.000Z"
    };
    const client = createClient({
      listSessionRuns: vi.fn(async () => ({
        runs: [
          {
            id: "run_1",
            sessionId: session.id,
            status: "completed" as const,
            createdAt: "2026-06-08T00:00:00.000Z",
            updatedAt: "2026-06-08T00:00:02.000Z"
          }
        ],
        toolCalls: [toolCall]
      }))
    });

    render(<App client={client} />);
    await selectSession("项目对话");
    const previewButton = await screen.findByTitle("预览文件");

    fireEvent.click(previewButton);

    expect(await screen.findByText("a.ts")).toBeInTheDocument();
    expect(await screen.findByText("line two")).toBeInTheDocument();
    expect(bridge.getFilePreviewInfo).toHaveBeenCalledWith("src/a.ts", {
      projectPath: project.path,
      sessionId: session.id
    });
    expect(bridge.readFilePreviewText).toHaveBeenCalledWith("/tmp/demo/src/a.ts", {
      maxBytes: 524288
    });
  });

  it("opens an HTML artifact in the right browser panel", async () => {
    const bridge = installPreviewBridge({
      kind: "html",
      fileUrl: "file:///tmp/demo/page.html"
    });
    const client = createClient({
      listMessages: vi.fn(async () => [artifactMessage("page.html")])
    });

    render(<App client={client} />);
    await selectSession("项目对话");
    await clickArtifactButton("page.html");

    await expectHtmlArtifactInBrowser(bridge);
  });

  it("renders PPTX artifacts in the embedded multi-page preview", async () => {
    const bridge = installPreviewBridge({
      kind: "presentation",
      buffer: previewBuffer("pptx")
    });
    const client = createClient({
      listMessages: vi.fn(async () => [artifactMessage("slides/demo.pptx")])
    });

    render(<App client={client} />);
    await selectSession("项目对话");
    await clickArtifactButton("demo.pptx");

    expect(await screen.findByText("1 / 2")).toBeInTheDocument();
    expect(await screen.findByTestId("pptx-rendered")).toHaveTextContent("第 2 页");
    expect(bridge.readFilePreviewBuffer).toHaveBeenCalledWith("/tmp/demo/slides/demo.pptx", {
      maxBytes: 26214400
    });
    expect(bridge.createQuickLookThumbnail).not.toHaveBeenCalled();
    expect(pptxRendererMock.open).toHaveBeenCalled();

    fireEvent.click(screen.getByTitle("下一页"));
    await waitFor(() => expect(screen.getByText("2 / 2")).toBeInTheDocument());
    expect(pptxRendererMock.goToSlide).toHaveBeenCalledWith(1, { behavior: "smooth", block: "start" });
  });

  it("falls back to a presentation thumbnail and system open for legacy PPT artifacts", async () => {
    const bridge = installPreviewBridge({
      kind: "presentation",
      thumbnailUrl: "data:image/png;base64,thumb"
    });
    const client = createClient({
      listMessages: vi.fn(async () => [artifactMessage("slides/demo.ppt")])
    });

    render(<App client={client} />);
    await selectSession("项目对话");
    await clickArtifactButton("demo.ppt");

    expect(await screen.findByText("旧版 PPT 演示文稿暂无法内嵌解析，请用系统应用打开。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "用系统应用打开" }));
    expect(bridge.openPath).toHaveBeenCalledWith("/tmp/demo/slides/demo.ppt");
  });

  it("opens a presentation artifact directly in file preview even without a project menu item", async () => {
    const bridge = installPreviewBridge({
      kind: "presentation",
      buffer: previewBuffer("pptx")
    });
    const client = createClient({
      listSessions: vi.fn(async () => [conversationSession]),
      listMessages: vi.fn(async () => [
        artifactMessage("AI日报_2026-06-12.pptx", { sessionId: conversationSession.id })
      ])
    });

    render(<App client={client} />);
    await selectSession("纯对话");
    fireEvent.click(await screen.findByTitle("打开侧边面板"));
    expect(await screen.findByRole("button", { name: "浏览器" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "产物" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "文件预览" })).not.toBeInTheDocument();

    await clickArtifactButton("AI日报_2026-06-12.pptx");

    expect(await screen.findByText("1 / 2")).toBeInTheDocument();
    expect(screen.getAllByText("AI日报_2026-06-12.pptx").length).toBeGreaterThan(1);
    expect(bridge.getFilePreviewInfo).toHaveBeenCalledWith("AI日报_2026-06-12.pptx", {
      sessionId: conversationSession.id,
      allowCwdFallback: false
    });
    expect(bridge.readFilePreviewBuffer).toHaveBeenCalledWith("/tmp/session_2/AI日报_2026-06-12.pptx", {
      maxBytes: 26214400
    });
  });

  it("keeps right panel preview memory scoped to each chat session", async () => {
    installPreviewBridge({
      kind: "presentation",
      buffer: previewBuffer("pptx")
    });
    const client = createClient({
      listSessions: vi.fn(async () => [session, secondSession]),
      listMessages: vi.fn(async (sessionId: string) =>
        sessionId === session.id ? [artifactMessage("slides/session-a.pptx")] : []
      )
    });

    render(<App client={client} />);
    await selectSession("项目对话");
    await clickArtifactButton("session-a.pptx");
    expect(await screen.findByText("1 / 2")).toBeInTheDocument();

    await clickSidebarSession("另一个项目对话");
    await waitFor(() =>
      expect(screen.queryByText("1 / 2")).not.toBeInTheDocument()
    );
    expect(screen.getByTitle("打开侧边面板")).toBeInTheDocument();
    expect(useAppStore.getState().rightPanelOpen).toBe(false);

    await clickSidebarSession("项目对话");
    expect(await screen.findByText("1 / 2")).toBeInTheDocument();
    expect(useAppStore.getState().rightPanelOpen).toBe(true);
    expect(useAppStore.getState().rightPanelMode).toBe("files");
  });

  it("restores file preview when returning from a top-level page to the same chat", async () => {
    installPreviewBridge({ kind: "code", text: "line one\nline two" });
    const client = createClient();

    render(<App client={client} />);
    await screen.findByText("项目对话");
    await selectSession("项目对话");

    act(() => {
      useAppStore.getState().openFilePreview("src/a.ts");
    });
    expect(await screen.findByText("a.ts")).toBeInTheDocument();
    expect(await screen.findByText("line one")).toBeInTheDocument();

    act(() => {
      useAppStore.getState().setView("tasks");
    });
    await waitFor(() => expect(useAppStore.getState().view).toBe("tasks"));
    act(() => {
      useAppStore.setState({
        rightPanelOpen: true,
        rightPanelMode: null,
        previewFile: undefined
      });
    });
    expect(useAppStore.getState().rightPanelBySession[session.id]?.mode).toBe("files");

    act(() => {
      useAppStore.getState().setView("chat");
    });
    expect(await screen.findByText("a.ts")).toBeInTheDocument();
    expect(await screen.findByText("line one")).toBeInTheDocument();
    expect(useAppStore.getState().rightPanelOpen).toBe(true);
    expect(useAppStore.getState().rightPanelMode).toBe("files");
    expect(useAppStore.getState().previewFile?.path).toBe("src/a.ts");
    expect(screen.queryByRole("button", { name: "文件预览" })).not.toBeInTheDocument();

    act(() => {
      useAppStore.getState().setView("tasks");
    });
    await waitFor(() => expect(useAppStore.getState().view).toBe("tasks"));
    act(() => {
      useAppStore.setState({
        rightPanelOpen: true,
        rightPanelMode: null,
        previewFile: undefined
      });
    });

    await clickSidebarSession("项目对话");

    expect(await screen.findByText("a.ts")).toBeInTheDocument();
    expect(await screen.findByText("line one")).toBeInTheDocument();
    expect(useAppStore.getState().rightPanelOpen).toBe(true);
    expect(useAppStore.getState().rightPanelMode).toBe("files");
    expect(useAppStore.getState().previewFile?.path).toBe("src/a.ts");
    expect(screen.queryByRole("button", { name: "文件预览" })).not.toBeInTheDocument();
  });

  it("routes DOCX, spreadsheet, and PDF artifacts into their embedded viewers", async () => {
    const docBridge = installPreviewBridge({ kind: "docx", buffer: previewBuffer("docx") });
    const { unmount } = render(
      <App
        client={createClient({
          listMessages: vi.fn(async () => [artifactMessage("report.docx")])
        })}
      />
    );
    await selectSession("项目对话");
    await clickArtifactButton("report.docx");
    await waitFor(() =>
      expect(document.querySelector('iframe[title="docx-preview"]')?.getAttribute("srcdoc")).toContain(
        "DOCX 内容预览"
      )
    );
    expect(docBridge.readFilePreviewBuffer).toHaveBeenCalledWith("/tmp/demo/report.docx", {
      maxBytes: 26214400
    });
    unmount();

    resetAppStore();
    const sheetBridge = installPreviewBridge({ kind: "spreadsheet", buffer: previewBuffer("sheet") });
    const sheetRender = render(
      <App
        client={createClient({
          listMessages: vi.fn(async () => [artifactMessage("data.xlsx")])
        })}
      />
    );
    await selectSession("项目对话");
    await clickArtifactButton("data.xlsx");
    expect(await screen.findByText("Sheet1")).toBeInTheDocument();
    expect(await screen.findByText("苹果")).toBeInTheDocument();
    expect(sheetBridge.readFilePreviewBuffer).toHaveBeenCalledWith("/tmp/demo/data.xlsx", {
      maxBytes: 26214400
    });
    sheetRender.unmount();

    resetAppStore();
    const pdfBridge = installPreviewBridge({ kind: "pdf", buffer: previewBuffer("%PDF") });
    render(
      <App
        client={createClient({
          listMessages: vi.fn(async () => [artifactMessage("brief.pdf")])
        })}
      />
    );
    await selectSession("项目对话");
    await clickArtifactButton("brief.pdf");
    expect(await screen.findByText("1 / 1")).toBeInTheDocument();
    expect(pdfBridge.readFilePreviewBuffer).toHaveBeenCalledWith("/tmp/demo/brief.pdf", {
      maxBytes: 26214400
    });
  });

  it("opens a file URL from the browser panel through the desktop bridge", async () => {
    const bridge = installPreviewBridge();
    const windowOpen = vi.spyOn(window, "open").mockImplementation(() => null);
    const client = createClient();

    render(<App client={client} />);
    await screen.findByText("项目对话");
    await selectSession("项目对话");
    useAppStore.getState().setBrowserUrl("file:///tmp/demo/page%20one.html");

    await openPane("浏览器");
    fireEvent.click(await screen.findByTitle("在系统中打开"));

    expect(bridge.openPath).toHaveBeenCalledWith("/tmp/demo/page one.html");
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it("browses to a normalized URL via the iframe fallback", async () => {
    const client = createClient();

    const { container } = render(<App client={client} />);
    await screen.findByText("项目对话");
    await selectSession("项目对话");

    await openPane("浏览器");
    const input = await screen.findByLabelText("输入网址，回车访问");

    fireEvent.change(input, { target: { value: "example.com" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    const frame = container.querySelector("iframe");
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("src")).toBe("https://example.com/");
  });

  it("renders the browser empty state with an icon and localized examples", async () => {
    const client = createClient();

    render(<App client={client} />);
    await screen.findByText("项目对话");
    await selectSession("项目对话");

    await openPane("浏览器");

    expect(screen.getByText("输入网址开始浏览，例如 baidu.com，或本地服务 localhost:5173。")).toBeInTheDocument();
    expect(screen.getByTestId("browser-empty-icon")).toBeInTheDocument();
  });
});
