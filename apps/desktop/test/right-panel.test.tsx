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
import type { Project, ProviderConfig, Session, ToolCall } from "@chengxiaobang/shared";

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
      const resolvedPath =
        context?.sessionId && !path.startsWith("/")
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

describe("right panel", () => {
  it("opens on the menu page, navigates back from a tool and closes", async () => {
    const client = createClient();

    render(<App client={client} />);
    await screen.findByText("项目对话");
    await selectSession("项目对话");

    fireEvent.click(await screen.findByTitle("打开侧边面板"));
    expect(await screen.findByRole("button", { name: "侧边会话" })).toBeInTheDocument();

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
    await waitFor(() => expect(getGitInfo).toHaveBeenCalledWith(project.id));
    expect(screen.queryByRole("button", { name: "变更" })).not.toBeInTheDocument();
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
    expect(bridge.readFilePreviewText).toHaveBeenCalledWith("/tmp/demo/src/a.ts", {
      maxBytes: 524288
    });
  });

  it("previews an HTML artifact in the right file panel", async () => {
    const bridge = installPreviewBridge({
      kind: "html",
      fileUrl: "file:///tmp/demo/page.html"
    });
    const toolCall: ToolCall = {
      id: "tool_html",
      runId: "run_1",
      name: "write_file",
      args: { path: "page.html", content: "<!doctype html>" },
      status: "completed",
      result: "已写入 page.html",
      createdAt: "2026-06-08T00:00:01.000Z",
      updatedAt: "2026-06-08T00:00:01.000Z"
    };
    const client = createClient({
      listSessionRuns: vi.fn(async () => ({ runs: [], toolCalls: [toolCall] }))
    });

    const { container } = render(<App client={client} />);
    await selectSession("项目对话");
    fireEvent.click(await screen.findByText("page.html"));

    expect(await screen.findByText("HTML / SVG · 17 B")).toBeInTheDocument();
    expect(container.querySelector("webview")?.getAttribute("src")).toBe("file:///tmp/demo/page.html");
    expect(bridge.createFileUrl).toHaveBeenCalledWith("/tmp/demo/page.html");
  });

  it("falls back to a presentation thumbnail and system open for PPT artifacts", async () => {
    const bridge = installPreviewBridge({
      kind: "presentation",
      thumbnailUrl: "data:image/png;base64,thumb"
    });
    const toolCall: ToolCall = {
      id: "tool_ppt",
      runId: "run_1",
      name: "create_pptx",
      args: { path: "slides/demo.pptx" },
      status: "completed",
      result: "已生成 slides/demo.pptx",
      createdAt: "2026-06-08T00:00:01.000Z",
      updatedAt: "2026-06-08T00:00:01.000Z"
    };
    const client = createClient({
      listSessionRuns: vi.fn(async () => ({ runs: [], toolCalls: [toolCall] }))
    });

    render(<App client={client} />);
    await selectSession("项目对话");
    fireEvent.click(await screen.findByText("demo.pptx"));

    expect(await screen.findByText("演示文稿暂以缩略图和系统打开为主。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "用系统应用打开" }));
    expect(bridge.openPath).toHaveBeenCalledWith("/tmp/demo/slides/demo.pptx");
  });

  it("opens a presentation artifact directly in file preview even without a project menu item", async () => {
    const bridge = installPreviewBridge({
      kind: "presentation",
      thumbnailUrl: "data:image/png;base64,thumb"
    });
    const toolCall: ToolCall = {
      id: "tool_conversation_ppt",
      runId: "run_1",
      name: "create_pptx",
      args: { path: "AI日报_2026-06-12.pptx" },
      status: "completed",
      result: "已生成 AI日报_2026-06-12.pptx",
      createdAt: "2026-06-08T00:00:01.000Z",
      updatedAt: "2026-06-08T00:00:01.000Z"
    };
    const client = createClient({
      listSessions: vi.fn(async () => [conversationSession]),
      listSessionRuns: vi.fn(async () => ({ runs: [], toolCalls: [toolCall] }))
    });

    render(<App client={client} />);
    await selectSession("纯对话");
    fireEvent.click(await screen.findByTitle("打开侧边面板"));
    expect(await screen.findByRole("button", { name: "浏览器" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "文件预览" })).not.toBeInTheDocument();

    fireEvent.click(await screen.findByText("AI日报_2026-06-12.pptx"));

    expect(await screen.findByText("演示文稿暂以缩略图和系统打开为主。")).toBeInTheDocument();
    expect(screen.getAllByText("AI日报_2026-06-12.pptx").length).toBeGreaterThan(1);
    expect(bridge.getFilePreviewInfo).toHaveBeenCalledWith("AI日报_2026-06-12.pptx", {
      sessionId: conversationSession.id
    });
    expect(bridge.createQuickLookThumbnail).toHaveBeenCalledWith(
      "/tmp/session_2/AI日报_2026-06-12.pptx"
    );
  });

  it("keeps right panel preview memory scoped to each chat session", async () => {
    installPreviewBridge({
      kind: "presentation",
      thumbnailUrl: "data:image/png;base64,thumb"
    });
    const toolCall: ToolCall = {
      id: "tool_session_ppt",
      runId: "run_1",
      name: "create_pptx",
      args: { path: "slides/session-a.pptx" },
      status: "completed",
      result: "已生成 slides/session-a.pptx",
      createdAt: "2026-06-08T00:00:01.000Z",
      updatedAt: "2026-06-08T00:00:01.000Z"
    };
    const client = createClient({
      listSessions: vi.fn(async () => [session, secondSession]),
      listSessionRuns: vi.fn(async (sessionId: string) => ({
        runs: [],
        toolCalls: sessionId === session.id ? [toolCall] : []
      }))
    });

    render(<App client={client} />);
    await selectSession("项目对话");
    fireEvent.click(await screen.findByText("session-a.pptx"));
    expect(await screen.findByText("演示文稿暂以缩略图和系统打开为主。")).toBeInTheDocument();

    await clickSidebarSession("另一个项目对话");
    await waitFor(() =>
      expect(screen.queryByText("演示文稿暂以缩略图和系统打开为主。")).not.toBeInTheDocument()
    );
    expect(screen.getByTitle("打开侧边面板")).toBeInTheDocument();
    expect(useAppStore.getState().rightPanelOpen).toBe(false);

    await clickSidebarSession("项目对话");
    expect(await screen.findByText("演示文稿暂以缩略图和系统打开为主。")).toBeInTheDocument();
    expect(useAppStore.getState().rightPanelOpen).toBe(true);
    expect(useAppStore.getState().rightPanelMode).toBe("files");
  });

  it("routes DOCX, spreadsheet, and PDF artifacts into their embedded viewers", async () => {
    const docBridge = installPreviewBridge({ kind: "docx", buffer: previewBuffer("docx") });
    const docTool: ToolCall = {
      id: "tool_doc",
      runId: "run_1",
      name: "create_docx",
      args: { path: "report.docx" },
      status: "completed",
      result: "已生成 report.docx",
      createdAt: "2026-06-08T00:00:01.000Z",
      updatedAt: "2026-06-08T00:00:01.000Z"
    };
    const { unmount } = render(
      <App
        client={createClient({
          listSessionRuns: vi.fn(async () => ({ runs: [], toolCalls: [docTool] }))
        })}
      />
    );
    await selectSession("项目对话");
    fireEvent.click(await screen.findByText("report.docx"));
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
    const sheetTool: ToolCall = {
      id: "tool_xlsx",
      runId: "run_1",
      name: "create_xlsx",
      args: { path: "data.xlsx" },
      status: "completed",
      result: "已生成 data.xlsx",
      createdAt: "2026-06-08T00:00:01.000Z",
      updatedAt: "2026-06-08T00:00:01.000Z"
    };
    const sheetRender = render(
      <App
        client={createClient({
          listSessionRuns: vi.fn(async () => ({ runs: [], toolCalls: [sheetTool] }))
        })}
      />
    );
    await selectSession("项目对话");
    fireEvent.click(await screen.findByText("data.xlsx"));
    expect(await screen.findByText("Sheet1")).toBeInTheDocument();
    expect(await screen.findByText("苹果")).toBeInTheDocument();
    expect(sheetBridge.readFilePreviewBuffer).toHaveBeenCalledWith("/tmp/demo/data.xlsx", {
      maxBytes: 26214400
    });
    sheetRender.unmount();

    resetAppStore();
    const pdfBridge = installPreviewBridge({ kind: "pdf", buffer: previewBuffer("%PDF") });
    const pdfTool: ToolCall = {
      id: "tool_pdf",
      runId: "run_1",
      name: "write_file",
      args: { path: "brief.pdf", content: "" },
      status: "completed",
      result: "已生成 brief.pdf",
      createdAt: "2026-06-08T00:00:01.000Z",
      updatedAt: "2026-06-08T00:00:01.000Z"
    };
    render(
      <App
        client={createClient({
          listSessionRuns: vi.fn(async () => ({ runs: [], toolCalls: [pdfTool] }))
        })}
      />
    );
    await selectSession("项目对话");
    fireEvent.click(await screen.findByText("brief.pdf"));
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
