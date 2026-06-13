// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import { Composer } from "../src/renderer/components/Composer";
import type { ApiClient } from "../src/renderer/lib/api";
import { resetAppStore, useAppStore } from "../src/renderer/store";
import type {
  Message,
  ProviderConfig,
  ProviderModelOption,
  Session,
  SlashCommand,
  StreamEvent,
  ToolCall
} from "@chengxiaobang/shared";

const deepseek: ProviderConfig = {
  id: "deepseek",
  kind: "deepseek",
  name: "DeepSeek",
  baseURL: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  apiKeyRef: "test:deepseek",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const kimiUnconfigured: ProviderConfig = {
  id: "kimi",
  kind: "kimi",
  name: "Kimi",
  baseURL: "https://api.moonshot.ai/v1",
  model: "kimi-k2.6",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const skillCommand: SlashCommand = {
  id: "global:skill:excel",
  name: "/excel",
  kind: "skill",
  description: "处理 Excel 表格",
  source: "global",
  insertText: "/excel "
};

const deepseekModelOptions: ProviderModelOption[] = [
  {
    id: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    providerKind: "deepseek",
    reasoningModes: ["off", "high", "xhigh"],
    source: "catalog"
  },
  {
    id: "deepseek-chat",
    providerKind: "deepseek",
    reasoningModes: [],
    source: "live"
  }
];

function createClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listProjects: vi.fn(async () => []),
    createProject: vi.fn() as never,
    renameProject: vi.fn() as never,
    deleteProject: vi.fn(async () => true),
    listSessions: vi.fn(async () => []),
    listProjectFiles: vi.fn(async () => []),
    getGitChanges: vi.fn(async () => ({ isRepo: false, files: [] })),
    updateSession: vi.fn() as never,
    deleteSession: vi.fn() as never,
    listMessages: vi.fn(async () => []),
    rewindSession: vi.fn(async () => []),
    forkSession: vi.fn() as never,
    listSessionRuns: vi.fn(async () => ({ runs: [], toolCalls: [] })),
    listSlashCommands: vi.fn(async () => ({ commands: [], diagnostics: [] })),
    listProviders: vi.fn(async () => [deepseek]),
    saveProvider: vi.fn() as never,
    deleteProvider: vi.fn(async () => true),
    testProvider: vi.fn() as never,
    listProviderModels: vi.fn(async () => []),
    listProviderModelOptions: vi.fn(async () => []),
    getFeishuConfig: vi.fn(async () => ({
      enabled: false,
      appId: "",
      domain: "feishu" as const,
      fullAccess: false
    })),
    saveFeishuConfig: vi.fn() as never,
    getFeishuStatus: vi.fn(async () => ({ status: "disconnected" as const })),
    approve: vi.fn() as never,
    abort: vi.fn() as never,
    terminalExec: vi.fn() as never,
    streamRun: vi.fn(async () => {}),
    ...overrides
  };
}

beforeAll(() => {
  // radix Select 在 jsdom 下需要的最小桩（popper 测量 + 滚动 + pointer capture）。
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false) as never;
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  window.HTMLElement.prototype.setPointerCapture = vi.fn();
  if (!("ResizeObserver" in window)) {
    (window as never as Record<string, unknown>).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

beforeEach(() => {
  window.localStorage.clear();
  resetAppStore();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:composer-image-preview")
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn()
  });
});

afterEach(() => {
  setDocumentVisibility("visible");
  delete (window as { chengxiaobang?: Window["chengxiaobang"] }).chengxiaobang;
  vi.useRealTimers();
});

async function openModelSelect(): Promise<HTMLElement> {
  const trigger = await screen.findByLabelText("选择模型");
  fireEvent.keyDown(trigger, { key: "Enter" });
  return trigger;
}

function setDocumentVisibility(visibilityState: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: visibilityState
  });
}

function installBridge(
  partial: Partial<NonNullable<Window["chengxiaobang"]>>
): NonNullable<Window["chengxiaobang"]> {
  const bridge = {
    getBackendInfo: vi.fn(async () => undefined),
    pickDirectory: vi.fn(async () => undefined),
    pickFiles: vi.fn(async () => []),
    readFileText: vi.fn() as never,
    ...partial
  } as NonNullable<Window["chengxiaobang"]>;
  Object.defineProperty(window, "chengxiaobang", {
    configurable: true,
    writable: true,
    value: bridge
  });
  return bridge;
}

function dragDataTransfer(files: File[]): DataTransfer {
  return {
    files,
    types: ["Files"],
    dropEffect: "none",
    effectAllowed: "all",
    items: files.map((file) => ({
      kind: "file",
      type: file.type,
      getAsFile: () => file
    }))
  } as unknown as DataTransfer;
}

describe("Composer 首页占位文案轮播", () => {
  it("uses permission colors on the access mode trigger", () => {
    useAppStore.setState({
      view: "home",
      input: "",
      providers: [deepseek],
      providerId: deepseek.id,
      accessMode: "approval",
      isRunning: false,
      pendingTool: undefined,
      slashCommands: []
    });

    render(<Composer />);

    expect(screen.getByRole("button", { name: /审批执行/ })).toHaveClass(
      "text-muted-foreground"
    );

    act(() => {
      useAppStore.setState({ accessMode: "smart_approval" });
    });
    expect(screen.getByRole("button", { name: /智能审批/ })).toHaveClass("text-link");

    act(() => {
      useAppStore.setState({ accessMode: "full_access" });
    });
    expect(screen.getByRole("button", { name: /完全访问/ })).toHaveClass("text-[#d25f28]");
  });

  it("pauses while hidden and restarts with a full interval when visible again", () => {
    vi.useFakeTimers();
    setDocumentVisibility("visible");
    useAppStore.setState({
      view: "home",
      input: "",
      providers: [deepseek],
      providerId: deepseek.id,
      isRunning: false,
      pendingTool: undefined,
      slashCommands: []
    });

    render(<Composer />);

    const rail = screen.getAllByText("随心输入，交给程小帮")[0]?.parentElement as HTMLElement;
    expect(rail.style.transform).toBe("translateY(-0px)");

    act(() => {
      vi.advanceTimersByTime(2800);
    });
    expect(rail.style.transform).toBe("translateY(-24px)");

    act(() => {
      setDocumentVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(2800 * 3);
    });
    expect(rail.style.transform).toBe("translateY(-24px)");

    act(() => {
      setDocumentVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(2799);
    });
    expect(rail.style.transform).toBe("translateY(-24px)");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(rail.style.transform).toBe("translateY(-48px)");
  });

  it("pauses while the window is blurred and resumes after focus", () => {
    vi.useFakeTimers();
    setDocumentVisibility("visible");
    useAppStore.setState({
      view: "home",
      input: "",
      providers: [deepseek],
      providerId: deepseek.id,
      isRunning: false,
      pendingTool: undefined,
      slashCommands: []
    });

    render(<Composer />);

    const rail = screen.getAllByText("随心输入，交给程小帮")[0]?.parentElement as HTMLElement;
    act(() => {
      vi.advanceTimersByTime(2800);
    });
    expect(rail.style.transform).toBe("translateY(-24px)");

    act(() => {
      window.dispatchEvent(new Event("blur"));
      vi.advanceTimersByTime(2800 * 3);
    });
    expect(rail.style.transform).toBe("translateY(-24px)");

    act(() => {
      window.dispatchEvent(new Event("focus"));
      vi.advanceTimersByTime(2799);
    });
    expect(rail.style.transform).toBe("translateY(-24px)");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(rail.style.transform).toBe("translateY(-48px)");
  });
});

describe("主区域文件拖拽上下文", () => {
  it("shows a focused drop state and requests copy semantics while dragging files", () => {
    render(<App client={createClient()} />);
    const dropZone = screen.getByTestId("main-drop-zone");
    const sidebar = screen.getByTestId("app-sidebar");
    const file = new File(["image"], "photo.png", { type: "image/png" });
    const dataTransfer = dragDataTransfer([file]);

    fireEvent.dragEnter(sidebar, { dataTransfer });
    expect(screen.queryByText("松开添加到上下文")).not.toBeInTheDocument();

    fireEvent.dragEnter(dropZone, { dataTransfer });
    expect(screen.getByText("松开添加到上下文")).toBeInTheDocument();

    fireEvent.dragOver(dropZone, { dataTransfer });
    expect(dataTransfer.dropEffect).toBe("copy");

    fireEvent.dragLeave(dropZone, { dataTransfer });
    expect(screen.queryByText("松开添加到上下文")).not.toBeInTheDocument();
  });

  it("adds dropped files through the Electron path bridge and existing preview metadata flow", async () => {
    const file = new File(["image"], "photo.png", { type: "image/png" });
    const bridge = installBridge({
      getPathForFile: vi.fn(() => "/tmp/photo.png"),
      getFilePreviewInfo: vi.fn(async () => ({
        ok: true,
        path: "/tmp/photo.png",
        name: "photo.png",
        size: 128,
        extension: "png",
        kind: "image" as const,
        label: "图片",
        canPreview: true
      })),
      readFilePreviewBuffer: vi.fn(async () => ({
        ok: true,
        path: "/tmp/photo.png",
        name: "photo.png",
        data: new ArrayBuffer(8),
        size: 128,
        truncated: false
      }))
    });
    render(<App client={createClient()} />);
    fireEvent.drop(screen.getByTestId("main-drop-zone"), {
      dataTransfer: dragDataTransfer([file])
    });

    expect(bridge.getPathForFile).toHaveBeenCalledWith(file);
    expect(bridge.getFilePreviewInfo).toHaveBeenCalledWith("/tmp/photo.png", {
      projectPath: undefined,
      sessionId: undefined
    });
    expect(await screen.findByAltText("附件图片 photo.png")).toHaveAttribute(
      "src",
      "blob:composer-image-preview"
    );
    expect(useAppStore.getState().attachments).toMatchObject([
      { path: "/tmp/photo.png", name: "photo.png", kind: "image", size: 128 }
    ]);

    fireEvent.click(screen.getByLabelText("打开附件 photo.png"));

    expect(await screen.findByText("图片 · 128 B")).toBeInTheDocument();
    expect(await screen.findByAltText("photo.png")).toHaveAttribute(
      "src",
      "blob:composer-image-preview"
    );
    expect(useAppStore.getState().rightPanelOpen).toBe(true);
    expect(useAppStore.getState().rightPanelMode).toBe("files");
  });

  it("skips duplicate dropped paths and reports files without local paths", async () => {
    const duplicate = new File(["image"], "photo.png", { type: "image/png" });
    const virtual = new File(["image"], "virtual.png", { type: "image/png" });
    const bridge = installBridge({
      getPathForFile: vi.fn((file: File) =>
        file.name === "photo.png" ? "/tmp/photo.png" : ""
      ),
      getFilePreviewInfo: vi.fn(async () => ({
        ok: true,
        path: "/tmp/photo.png",
        name: "photo.png",
        size: 128,
        extension: "png",
        kind: "image" as const,
        label: "图片",
        canPreview: true
      }))
    });
    render(<App client={createClient()} />);
    act(() => {
      useAppStore.setState({
        providers: [deepseek],
        providerId: deepseek.id,
        slashCommands: [],
        attachments: [{ path: "/tmp/photo.png", name: "photo.png", size: 128, kind: "image" }]
      });
    });
    fireEvent.drop(screen.getByTestId("main-drop-zone"), {
      dataTransfer: dragDataTransfer([duplicate, virtual])
    });

    await waitFor(() =>
      expect(useAppStore.getState().notice).toBe("拖拽文件没有可读取的本地路径，已跳过。")
    );
    expect(bridge.getFilePreviewInfo).not.toHaveBeenCalled();
    expect(useAppStore.getState().attachments).toHaveLength(1);
  });

  it("allows attachment-only submission and sends prepared text context", async () => {
    const streamRun = vi.fn(async (..._args: Parameters<ApiClient["streamRun"]>) => {});
    const client = createClient({ streamRun: streamRun as never });
    installBridge({
      saveAttachmentSnapshots: vi.fn(async () => ({
        ok: true,
        attachments: [
          {
            id: "attachment_snapshot_1",
            path: "/tmp/note.txt",
            name: "note.txt",
            kind: "text",
            size: 5
          }
        ],
        totalBytes: 5,
        elapsedMs: 1
      })),
      readFilePreviewText: vi.fn(async () => ({
        ok: true,
        path: "/tmp/note.txt",
        name: "note.txt",
        text: "hello",
        size: 5,
        truncated: false
      }))
    });

    render(<App client={client} />);
    await waitFor(() => expect(useAppStore.getState().clientReady).toBe(true));
    act(() => {
      useAppStore.setState({
        providers: [deepseek],
        providerId: deepseek.id,
        attachments: [
          {
            path: "/tmp/note.txt",
            name: "note.txt",
            size: 5,
            kind: "text",
            text: "hello"
          }
        ]
      });
    });

    expect(await screen.findByText("hello")).toBeInTheDocument();
    expect(screen.getByText("note.txt")).toBeInTheDocument();
    const send = screen.getByTitle("发送");
    expect(send).not.toBeDisabled();
    fireEvent.click(send);

    await waitFor(() => expect(streamRun).toHaveBeenCalled());
    expect(streamRun.mock.calls[0]?.[0]).toMatchObject({
      providerId: "deepseek",
      prompt: expect.stringContaining("以下是文件 note.txt 的内容")
    });
  });
});

describe("Composer 模型两级下拉（ARCH-SPEC §6.4）", () => {
  it("uses startRun plus the global event listener when available", async () => {
    let emit: ((event: StreamEvent) => void) | undefined;
    const subscribeRunEvents = vi.fn((listener: (event: StreamEvent) => void) => {
      emit = listener;
      return vi.fn();
    });
    const startRun = vi.fn(async (input: Parameters<NonNullable<ApiClient["startRun"]>>[0]) => ({
      runId: "run_global",
      sessionId: "session_global",
      clientRequestId: input.clientRequestId,
      providerId: "deepseek",
      model: "deepseek-v4-flash"
    }));
    const streamRun = vi.fn(async () => {});
    const client = createClient({
      startRun,
      subscribeRunEvents,
      streamRun: streamRun as never
    });

    render(<App client={client} />);
    const input = await screen.findByLabelText("输入消息");
    fireEvent.change(input, { target: { value: "走全局流" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(startRun).toHaveBeenCalled());
    expect(streamRun).not.toHaveBeenCalled();
    expect(startRun.mock.calls[0]?.[0]).toMatchObject({
      providerId: "deepseek",
      clientRequestId: expect.any(String)
    });
    await waitFor(() => expect(useAppStore.getState().activeRunId).toBe("run_global"));

    const assistant: Message = {
      id: "msg_assistant",
      sessionId: "session_global",
      role: "assistant",
      content: "全局事件到了",
      createdAt: "2026-06-13T00:00:00.000Z"
    };
    emit?.({ type: "message", runId: "run_global", message: assistant });
    expect(await screen.findByText("全局事件到了")).toBeInTheDocument();
    emit?.({ type: "run_end", runId: "run_global", status: "completed" });
    await waitFor(() => expect(useAppStore.getState().isRunning).toBe(false));
  });

  it("selects a model: setProviderId + setModel, and the run request carries providerId + model", async () => {
    const listProviderModelOptions = vi.fn(async () => deepseekModelOptions);
    const streamRun = vi.fn(async (..._args: Parameters<ApiClient["streamRun"]>) => {});
    const client = createClient({
      listProviders: vi.fn(async () => [deepseek, kimiUnconfigured]),
      listProviderModelOptions,
      streamRun: streamRun as never
    });

    render(<App client={client} />);
    await screen.findByTestId("composer-shell");
    await openModelSelect();

    // 模型选项只拉取已配置 API Key 的 provider。
    await waitFor(() => expect(listProviderModelOptions).toHaveBeenCalledWith("deepseek"));
    expect(listProviderModelOptions).not.toHaveBeenCalledWith("kimi");
    // 平铺模型列表（不再有厂商分组小标题），菜单里直接出现模型项。
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("DeepSeek V4 Flash")).toBeInTheDocument();

    // hover 模型展开右侧 flyout，再在里面选定（deepseek-chat 无推理强度，只有「默认」）。
    const row = within(menu).getByText("deepseek-chat");
    fireEvent.pointerDown(row, { button: 0 });
    fireEvent.click(row);
    fireEvent.click(await screen.findByText("默认"));

    await waitFor(() => {
      expect(useAppStore.getState().providerId).toBe("deepseek");
      expect(useAppStore.getState().model).toBe("deepseek-chat");
    });

    const input = screen.getByLabelText("输入消息");
    fireEvent.change(input, { target: { value: "换个模型跑" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(streamRun).toHaveBeenCalled());
    expect(streamRun.mock.calls[0]?.[0]).toMatchObject({
      providerId: "deepseek",
      model: "deepseek-chat"
    });
  });

  it("falls back to the provider's single default model when the model list fetch fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const listProviderModelOptions = vi.fn(async () => {
      throw new Error("拉取失败");
    });
    const client = createClient({ listProviderModelOptions });

    render(<App client={client} />);
    await screen.findByTestId("composer-shell");
    await openModelSelect();

    await waitFor(() => expect(listProviderModelOptions).toHaveBeenCalledWith("deepseek"));
    // 回退到静态目录：DeepSeek 供应商下默认展示 Flash / Pro。
    expect((await screen.findAllByText("DeepSeek V4 Flash")).length).toBeGreaterThan(0);
    expect(screen.getByText("DeepSeek V4 Pro")).toBeInTheDocument();
    warn.mockRestore();
  });
});

describe("Composer 计划模式（＋下拉 Switch + 标记）", () => {
  it("toggles planMode from the + menu switch, shows the marker, and sends planMode in the run request", async () => {
    const streamRun = vi.fn(async (..._args: Parameters<ApiClient["streamRun"]>) => {});
    const client = createClient({ streamRun: streamRun as never });

    render(<App client={client} />);
    await screen.findByTestId("composer-shell");

    // 打开「＋」下拉，点击「计划模式」开关项。
    const plusTrigger = screen.getByTitle("添加上下文");
    fireEvent.pointerDown(plusTrigger, { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByText("计划模式"));

    expect(useAppStore.getState().planMode).toBe(true);
    // 开启后，「对话」右侧出现蓝色「计划模式」标记（点击可关闭）。
    expect(await screen.findByTitle("关闭计划模式")).toBeInTheDocument();

    const input = screen.getByLabelText("输入消息");
    fireEvent.change(input, { target: { value: "先做个计划" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(streamRun).toHaveBeenCalled());
    expect(streamRun.mock.calls[0]?.[0]).toMatchObject({ planMode: true });
  });

  it("hides the normal composer while the proposed plan is waiting for confirmation", async () => {
    const planTool: ToolCall = {
      id: "tool_plan",
      runId: "run_1",
      name: "propose_plan",
      args: {
        markdown:
          "# 示例计划\n\n## Summary\n先确认计划。\n\n## Key Changes\n- 调整 UI。\n\n## Test Plan\n- 检查计划卡。\n\n## Assumptions\n- 当前会话继续执行。"
      },
      status: "pending_approval",
      createdAt: "2026-06-13T00:00:01.000Z",
      updatedAt: "2026-06-13T00:00:01.000Z"
    };
    let resolveStream: (() => void) | undefined;
    const streamRun = vi.fn(async (..._args: Parameters<ApiClient["streamRun"]>) => {
      const onEvent = _args[1];
      onEvent({ type: "run_started", runId: "run_1", sessionId: "session_1" });
      onEvent({ type: "tool_call", runId: "run_1", toolCall: planTool });
      return new Promise<void>((resolve) => {
        resolveStream = resolve;
      });
    });
    const client = createClient({ streamRun: streamRun as never });

    render(<App client={client} />);
    const input = await screen.findByLabelText("输入消息");
    fireEvent.change(input, { target: { value: "先做个计划" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByTestId("plan-approval-dock")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByLabelText("输入消息")).not.toBeInTheDocument());
    resolveStream?.();
  });

  it("opens the skills page with the add dialog from the + menu", async () => {
    const client = createClient();
    render(<App client={client} />);
    await screen.findByTestId("composer-shell");

    const plusTrigger = screen.getByTitle("添加上下文");
    fireEvent.pointerDown(plusTrigger, { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByText("添加技能"));

    await waitFor(() => expect(useAppStore.getState().view).toBe("skills"));
    // 进入技能页后自动打开「添加技能」弹窗：GitHub 链接输入框可见。
    expect(await screen.findByLabelText("GitHub 链接")).toBeInTheDocument();
  });

  it("opens the skills page to manage skills from the + menu", async () => {
    const client = createClient();
    render(<App client={client} />);
    await screen.findByTestId("composer-shell");

    const plusTrigger = screen.getByTitle("添加上下文");
    fireEvent.pointerDown(plusTrigger, { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByText("管理技能"));

    await waitFor(() => expect(useAppStore.getState().view).toBe("skills"));
    // 仅进入技能页，不自动弹出添加弹窗。
    expect(screen.queryByLabelText("GitHub 链接")).not.toBeInTheDocument();
  });

  it("toggles planMode with Shift+Tab in the textarea", async () => {
    const client = createClient();

    render(<App client={client} />);
    await screen.findByTestId("composer-shell");
    const input = screen.getByLabelText("输入消息");

    expect(useAppStore.getState().planMode).toBe(false);
    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    expect(useAppStore.getState().planMode).toBe(true);
    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    expect(useAppStore.getState().planMode).toBe(false);
  });
});

describe("Composer ask-user 等待期（UI-SPEC §8）", () => {
  it("uses an active placeholder during a normal running stream", async () => {
    let resolveStream: (() => void) | undefined;
    const streamRun = vi.fn(async (..._args: Parameters<ApiClient["streamRun"]>) => {
      const onEvent = _args[1];
      onEvent({ type: "run_started", runId: "run_1", sessionId: "session_1" });
      return new Promise<void>((resolve) => {
        resolveStream = resolve;
      });
    });
    const client = createClient({ streamRun: streamRun as never });

    render(<App client={client} />);
    const input = await screen.findByLabelText("输入消息");
    fireEvent.change(input, { target: { value: "开始" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByPlaceholderText("程小帮正在处理当前请求…")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("随心输入")).not.toBeInTheDocument();
    resolveStream?.();
  });

  it("hides the normal composer and answers from the ask_user dock", async () => {
    const approve = vi.fn(async () => {});
    const ask: ToolCall = {
      id: "tool_q1",
      runId: "run_1",
      name: "ask_user",
      args: { questions: [{ question: "选哪个方案？" }] },
      status: "pending_approval",
      createdAt: "2026-06-11T00:00:01.000Z",
      updatedAt: "2026-06-11T00:00:01.000Z"
    };
    let resolveStream: (() => void) | undefined;
    const streamRun = vi.fn(async (..._args: Parameters<ApiClient["streamRun"]>) => {
      const onEvent = _args[1];
      onEvent({ type: "run_started", runId: "run_1", sessionId: "session_1" });
      onEvent({ type: "tool_call", runId: "run_1", toolCall: ask });
      return new Promise<void>((resolve) => {
        resolveStream = resolve;
      });
    });
    const client = createClient({ approve: approve as never, streamRun: streamRun as never });

    render(<App client={client} />);
    const input = await screen.findByLabelText("输入消息");
    fireEvent.change(input, { target: { value: "开始" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const dock = await screen.findByTestId("approval-dock");
    await waitFor(() => expect(screen.queryByLabelText("输入消息")).not.toBeInTheDocument());

    const customInput = within(dock).getByPlaceholderText("输入你的回答");
    fireEvent.change(customInput, { target: { value: "都不要，用 C 方案" } });
    fireEvent.keyDown(customInput, { key: "Enter" });

    await waitFor(() =>
      expect(approve).toHaveBeenCalledWith("tool_q1", {
        approved: true,
        answer: { answers: [{ question: "选哪个方案？", text: "都不要，用 C 方案" }] }
      })
    );
    expect(streamRun).toHaveBeenCalledTimes(1);
    resolveStream?.();
  });
});

describe("Composer slash 菜单技能标（ARCH-SPEC §5.5）", () => {
  it("marks skill entries with a 「技」 StampBadge", async () => {
    const client = createClient({
      listSlashCommands: vi.fn(async () => ({
        commands: [
          {
            id: "builtin:/ls",
            name: "/ls",
            kind: "builtin_tool" as const,
            description: "列出当前项目目录内容",
            source: "builtin" as const,
            insertText: "/ls "
          },
          skillCommand
        ],
        diagnostics: []
      }))
    });

    render(<App client={client} />);
    const input = await screen.findByLabelText("输入消息");
    fireEvent.change(input, { target: { value: "/" } });

    const menu = await screen.findByLabelText("斜杠命令建议");
    expect(menu).toHaveTextContent("/excel");
    expect(within(menu).queryByText("/ls")).not.toBeInTheDocument();
    // 斜杠建议只显示技能，技能行带印章标（title/aria-label = 技能）。
    const badges = within(menu).getAllByTitle("技能");
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveTextContent("技");

    fireEvent.click(within(menu).getByText("/excel"));
    expect(input).toHaveValue("/excel ");
  });
});

describe("HomeStarters 目录式启动区（UI-SPEC §3.1 / ARCH-SPEC §5.5）", () => {
  it("submits a complete starter task and runs it on click", async () => {
    const streamRun = vi.fn(async (..._args: Parameters<ApiClient["streamRun"]>) => {});
    const client = createClient({ streamRun: streamRun as never });

    render(<App client={client} />);
    await screen.findByTestId("composer-shell");

    fireEvent.click(screen.getByText("做一份 PPT"));

    // 点击即提交：发起运行，且任务文案已自包含（无需用户再编辑）。
    await waitFor(() => expect(streamRun).toHaveBeenCalled());
    expect(streamRun.mock.calls[0]?.[0]?.prompt).toContain("演示文稿");
  });
});
