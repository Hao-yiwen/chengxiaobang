// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import {
  extensionOf,
  previewDescriptorForKind,
  previewKindForPath,
  type PreviewKind
} from "../src/common/file-preview";
import type { ApiClient } from "../src/renderer/lib/api";
import type { TerminalDataEvent, TerminalExitEvent } from "../src/renderer/global";
import { resetAppStore, useAppStore } from "../src/renderer/store";
import type {
  Message,
  Project,
  ProjectFileEntry,
  ProviderConfig,
  Session,
  ToolCall
} from "@chengxiaobang/shared";

const terminalMock = vi.hoisted(() => {
  class MockTerminal {
    static instances: MockTerminal[] = [];
    cols = 80;
    rows = 24;
    element?: HTMLElement;
    dataListeners: Array<(data: string) => void> = [];
    focus = vi.fn();
    dispose = vi.fn();
    write = vi.fn((data: string) => {
      if (this.element) {
        this.element.textContent = `${this.element.textContent ?? ""}${data}`;
      }
    });

    constructor() {
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

vi.mock("@xterm/xterm", () => ({ Terminal: terminalMock.MockTerminal }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: terminalMock.MockFitAddon }));
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
  resetAppStore();
});

afterEach(() => {
  delete (window as { chengxiaobang?: unknown }).chengxiaobang;
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

/** Opens the panel via the toggle and enters a tool page from the menu. */
async function openPane(name: string): Promise<void> {
  fireEvent.click(await screen.findByTitle("打开侧边面板"));
  fireEvent.click(await screen.findByRole("button", { name }));
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

function todoToolCall(
  id: string,
  name: "todo_create" | "todo_update",
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

function historicalTodoToolCall(partial: Partial<ToolCall>): ToolCall {
  return {
    id: "todo_history_1",
    runId: "run_history",
    name: "todo_create",
    args: {
      title: "历史执行进度",
      items: [{ id: "s1", title: "历史步骤" }]
    },
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
            "todo_create",
            {
              title: "实现进度面板",
              items: [
                { id: "s1", title: "新增契约" },
                { id: "s2", title: "接入右侧面板" }
              ]
            },
            "running"
          )
        },
        { force: true }
      );
      store.handleRunEvent(
        {
          type: "tool_call",
          runId: "run_todo",
          toolCall: todoToolCall("todo_2", "todo_update", {
            itemId: "s1",
            status: "completed",
            note: "共享契约完成"
          })
        },
        { force: true }
      );
    });

    expect(useAppStore.getState().progressPanelOpen).toBe(true);
    expect(useAppStore.getState().rightPanelOpen).toBe(false);
    expect(useAppStore.getState().rightPanelMode).toBeNull();
    expect(screen.queryByTestId("right-panel")).not.toBeInTheDocument();
    expect(await screen.findByTestId("progress-floating-panel")).toBeInTheDocument();
    expect(await screen.findByText("实现进度面板")).toBeInTheDocument();
    expect(screen.getByText("共享契约完成")).toBeInTheDocument();
    expect(screen.getByText("完成")).toBeInTheDocument();
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
            args: {
              title: "历史执行进度",
              items: [
                { id: "s1", title: "读取项目结构" },
                { id: "s2", title: "生成总结" }
              ]
            }
          }),
          historicalTodoToolCall({
            id: "todo_history_2",
            name: "todo_update",
            args: {
              itemId: "s1",
              status: "completed",
              note: "项目结构读取完成"
            },
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
    expect(screen.getByText("历史执行进度")).toBeInTheDocument();
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
            args: {
              title: "已完成的历史进度",
              items: [{ id: "s1", title: "完成页面" }]
            }
          }),
          historicalTodoToolCall({
            id: "todo_done_2",
            name: "todo_update",
            args: { itemId: "s1", status: "completed", note: "页面已完成" },
            createdAt: "2026-06-12T00:00:02.000Z",
            updatedAt: "2026-06-12T00:00:02.000Z"
          })
        ]
      }))
    });

    render(<App client={client} />);
    await selectSession("项目对话");

    expect(await screen.findByTestId("progress-floating-panel")).toBeInTheDocument();
    expect(screen.getByText("已完成的历史进度")).toBeInTheDocument();
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
    expect(screen.getByText("页面已完成")).toBeInTheDocument();
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
    expect(await screen.findByText("历史执行进度")).toBeInTheDocument();

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
          toolCall: todoToolCall("todo_1", "todo_create", {
            title: "当前运行进度",
            items: [{ id: "s1", title: "开始执行" }]
          })
        },
        { force: true }
      );
    });

    expect(await screen.findByTestId("progress-floating-panel")).toBeInTheDocument();
    expect(screen.getByText("当前运行")).toBeInTheDocument();
    expect(screen.getByText("当前运行进度")).toBeInTheDocument();
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
          toolCall: todoToolCall("todo_1", "todo_create", {
            title: "稳定右侧面板宽度",
            items: [{ id: "s1", title: "预留滚动条空间并约束长文本" }]
          })
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
    expect(panel).not.toHaveClass("shadow-overlay", "backdrop-blur-sm", "bg-card/95");
    expect(scrollRegion).toHaveClass("overflow-x-hidden", "[scrollbar-gutter:stable]");

    act(() => {
      const store = useAppStore.getState();
      store.handleRunEvent(
        {
          type: "tool_call",
          runId: "run_todo",
          toolCall: todoToolCall("todo_2", "todo_update", {
            itemId: "s1",
            status: "completed",
            note: "这是一段较长的流式进度说明，用来模拟更新进入面板时的内容增长。".repeat(
              5
            )
          })
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
          toolCall: todoToolCall("todo_1", "todo_create", {
            title: "实现进度面板",
            items: [{ id: "s1", title: "新增契约" }]
          })
        },
        { force: true }
      );
    });
    expect(await screen.findByText("实现进度面板")).toBeInTheDocument();
    expect(screen.getByTestId("progress-floating-panel")).toHaveClass("rounded-xl");
    expect(screen.queryByTitle("关闭进度")).not.toBeInTheDocument();

    act(() => {
      useAppStore.getState().handleRunEvent(
        {
          type: "tool_call",
          runId: "run_todo",
          toolCall: todoToolCall("todo_2", "todo_create", {
            title: "第二份清单",
            items: [{ id: "s2", title: "继续执行" }]
          })
        },
        { force: true }
      );
    });

    expect(useAppStore.getState().rightPanelOpen).toBe(false);
    expect(useAppStore.getState().progressPanelOpen).toBe(true);
    expect(await screen.findByText("第二份清单")).toBeInTheDocument();
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
          toolCall: todoToolCall("todo_1", "todo_create", {
            title: "对话右侧进度",
            items: [{ id: "s1", title: "保持工具入口可用" }]
          })
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

    render(<App client={client} />);
    await screen.findByText("项目对话");
    await selectSession("项目对话");

    await openPane("终端");
    const terminal = await screen.findByLabelText("终端");
    await waitFor(() => expect(bridge.terminalStart).toHaveBeenCalled());
    const startInput = bridge.terminalStart.mock.calls[0][0];
    expect(startInput).toMatchObject({ cwd: "/tmp/demo", cols: 100, rows: 30 });

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
    expect(screen.queryByRole("button", { name: "变更" })).not.toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: "变更" })).not.toBeInTheDocument();
  });

  it("lists active project files in the file preview panel and opens them with project context", async () => {
    const bridge = installPreviewBridge({ kind: "code", text: "line one\nline two" });
    const rootEntries: ProjectFileEntry[] = [
      { name: "src", path: "src", type: "directory" },
      { name: "README.md", path: "README.md", type: "file" }
    ];
    const listProjectDirectory = vi.fn(async (projectId: string, path = ".") =>
      projectId === project.id && path === "." ? rootEntries : []
    );
    const client = createClient({ listProjectDirectory });

    render(<App client={client} />);
    await screen.findByText("项目对话");
    await selectSession("项目对话");
    await openPane("文件预览");

    expect(await screen.findByText("项目文件")).toBeInTheDocument();
    expect(await screen.findByText("README.md")).toBeInTheDocument();
    expect(listProjectDirectory).toHaveBeenCalledWith(project.id, ".");

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

  it("lists final XML artifacts in the floating artifact panel and opens preview", async () => {
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

    expect(await screen.findByText("HTML / SVG · 17 B")).toBeInTheDocument();
    expect(bridge.getFilePreviewInfo).toHaveBeenCalledWith("page.html", {
      projectPath: project.path,
      sessionId: session.id,
      allowCwdFallback: false
    });
    expect(bridge.createFileUrl).toHaveBeenCalledWith("/tmp/demo/page.html");
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

  it("restores legacy HTML tool artifacts in the floating artifact panel", async () => {
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
            name: "write_file",
            args: { path: "page.html", content: "<!doctype html>" },
            status: "completed",
            createdAt: "2026-06-08T00:00:01.000Z",
            updatedAt: "2026-06-08T00:00:02.000Z"
          },
          {
            id: "tool_code",
            runId: "run_code",
            name: "write_file",
            args: { path: "src/App.tsx", content: "export {}" },
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

    expect(await screen.findByText("HTML / SVG · 17 B")).toBeInTheDocument();
    expect(bridge.getFilePreviewInfo).toHaveBeenCalledWith("page.html", {
      projectPath: project.path,
      sessionId: session.id,
      allowCwdFallback: false
    });
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
          toolCall: todoToolCall("todo_1", "todo_create", {
            title: "带产物的任务",
            items: [{ id: "s1", title: "生成页面" }]
          })
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

    expect(await screen.findByRole("button", { name: "变更" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "终端" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "文件预览" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "产物" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "进度" })).not.toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: "变更" })).not.toBeInTheDocument();
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
      name: "read_file",
      args: { path: "src/a.ts" },
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

  it("previews an HTML artifact in the right file panel", async () => {
    const bridge = installPreviewBridge({
      kind: "html",
      fileUrl: "file:///tmp/demo/page.html"
    });
    const client = createClient({
      listMessages: vi.fn(async () => [artifactMessage("page.html")])
    });

    const { container } = render(<App client={client} />);
    await selectSession("项目对话");
    await clickArtifactButton("page.html");

    expect(await screen.findByText("HTML / SVG · 17 B")).toBeInTheDocument();
    expect(container.querySelector("webview")?.getAttribute("src")).toBe("file:///tmp/demo/page.html");
    expect(bridge.createFileUrl).toHaveBeenCalledWith("/tmp/demo/page.html");
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
});
