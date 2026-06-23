// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import type { ApiClient } from "../src/renderer/lib/api";
import {
  anchorScrollTop,
  contentTop,
  isNearBottom,
  tailSpacerHeight
} from "../src/renderer/lib/scroll";
import { resetAppStore, useAppStore } from "../src/renderer/store";
import type { Message, ProviderConfig, Session, StreamEvent } from "@chengxiaobang/shared";

describe("isNearBottom", () => {
  it("is true within the threshold and false at or beyond it", () => {
    const el = (scrollTop: number) => ({ scrollHeight: 1000, clientHeight: 300, scrollTop });
    // remaining = 1000 - scrollTop - 300
    expect(isNearBottom(el(581))).toBe(true); // 119px left
    expect(isNearBottom(el(580))).toBe(false); // exactly 120px left
    expect(isNearBottom(el(579))).toBe(false); // 121px left
  });

  it("treats an unmeasured (zero-size) element as at the bottom", () => {
    expect(isNearBottom({ scrollHeight: 0, clientHeight: 0, scrollTop: 0 })).toBe(true);
  });
});

describe("anchor geometry helpers", () => {
  it("contentTop converts viewport rect tops into the scroll content space", () => {
    // 消息矩形在容器顶部下方 10px，当前滚动位置为 800px。
    expect(contentTop(10, 0, 800)).toBe(810);
    // 容器自身偏移会被抵消，例如顶部还有其他应用框架区域。
    expect(contentTop(110, 100, 800)).toBe(810);
  });

  it("anchorScrollTop keeps the top margin and clamps at zero", () => {
    expect(anchorScrollTop(810)).toBe(794);
    expect(anchorScrollTop(20)).toBe(4);
    expect(anchorScrollTop(10)).toBe(0); // 顶部留白会让结果为负数，因此需要钳制到 0。
  });

  it("tailSpacerHeight fills exactly one viewport below the anchor", () => {
    // 本轮内容高度为 50px(860 - 810)，spacer 需要补足一屏。
    expect(
      tailSpacerHeight({ anchorContentTop: 810, naturalScrollHeight: 860, clientHeight: 300 })
    ).toBe(234);
    // 本轮内容超过一屏后，spacer 应折叠为 0。
    expect(
      tailSpacerHeight({ anchorContentTop: 810, naturalScrollHeight: 1200, clientHeight: 300 })
    ).toBe(0);
    // 亚像素矩形向上取整，避免目标滚动位置差 1px 不可达。
    expect(
      tailSpacerHeight({ anchorContentTop: 810.4, naturalScrollHeight: 860, clientHeight: 300 })
    ).toBe(235);
  });
});

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

const session: Session = {
  id: "session_1",
  projectId: null,
  title: "长对话",
  providerId: "deepseek",
  accessMode: "approval",
  createdAt: "2026-06-08T00:00:00.000Z",
  updatedAt: "2026-06-08T00:00:02.000Z"
};

const messages: Message[] = [
  {
    id: "u1",
    sessionId: session.id,
    role: "user",
    content: "问题",
    createdAt: "2026-06-08T00:00:00.000Z"
  },
  {
    id: "a1",
    sessionId: session.id,
    role: "assistant",
    content: "很长的回答",
    createdAt: "2026-06-08T00:00:01.000Z"
  }
];

function createClient(): ApiClient {
  return {
    listProjects: vi.fn(async () => []),
    createProject: vi.fn() as never,
    listSessions: vi.fn(async () => [session]),
    listProjectFiles: vi.fn(async () => []),
    updateSession: vi.fn() as never,
    deleteSession: vi.fn() as never,
    getGitChanges: vi.fn(async () => ({ isRepo: false, files: [] })),
    listMessages: vi.fn(async () => messages),
    rewindSession: vi.fn(async () => []),
    forkSession: vi.fn() as never,
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
    streamRun: vi.fn(async () => {})
  };
}

beforeEach(() => {
  window.localStorage.clear();
  resetAppStore();
  // 滚动行为都发生在对话视图里，模拟已完成首启后停在对话。
  useAppStore.setState({ view: "chat", onboardingOpen: false, onboardingCompleted: true });
});

describe("scroll-to-bottom button", () => {
  it("keeps the horizontal blank gutter inside the chat scroller", async () => {
    render(<App client={createClient()} />);
    await screen.findByText("很长的回答");

    const scroller = screen.getByTestId("chat-scroll");
    const chatStack = screen.getByTestId("chat-layout-scope").firstElementChild;
    const composerDock = screen.getByTestId("chat-composer-column").parentElement;

    expect(scroller).toHaveClass("px-12");
    expect(composerDock).toHaveClass("px-12");
    expect(chatStack).not.toHaveClass("px-12");
  });

  it("appears when scrolled away and smooth-scrolls back on click", async () => {
    render(<App client={createClient()} />);
    await screen.findByText("很长的回答");

    const scroller = screen.getByTestId("chat-scroll");
    Object.defineProperty(scroller, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(scroller, "clientHeight", { value: 300, configurable: true });

    // Far from the bottom → the button shows up.
    scroller.scrollTop = 0;
    fireEvent.scroll(scroller);
    const button = await screen.findByRole("button", { name: "回到底部" });

    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      value: scrollIntoView,
      configurable: true,
      writable: true
    });
    fireEvent.click(button);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "end" });

    // Back near the bottom → the button disappears.
    scroller.scrollTop = 700;
    fireEvent.scroll(scroller);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "回到底部" })).not.toBeInTheDocument()
    );
  });
});

// 原型级 mock 读取的可变几何信息：jsdom 没有真实布局，而锚定 effect 会在回显
// commit 中同步测量，因此节点创建后再对实例打补丁会太晚。
const metrics = {
  scrollHeight: 0,
  clientHeight: 0,
  rectTops: {} as Record<string, number>
};
const resizeObserverCallbacks = new Set<ResizeObserverCallback>();

function metricsKey(el: Element): string {
  return el.getAttribute("data-message-id") ?? el.getAttribute("data-testid") ?? "";
}

function installMetrics() {
  const proto = Element.prototype;
  const original = {
    scrollHeight: Object.getOwnPropertyDescriptor(proto, "scrollHeight"),
    clientHeight: Object.getOwnPropertyDescriptor(proto, "clientHeight"),
    getBoundingClientRect: proto.getBoundingClientRect
  };
  Object.defineProperty(proto, "scrollHeight", {
    configurable: true,
    get(this: Element) {
      return metricsKey(this) === "chat-scroll" ? metrics.scrollHeight : 0;
    }
  });
  Object.defineProperty(proto, "clientHeight", {
    configurable: true,
    get(this: Element) {
      return metricsKey(this) === "chat-scroll" ? metrics.clientHeight : 0;
    }
  });
  proto.getBoundingClientRect = function (this: Element) {
    const top = metrics.rectTops[metricsKey(this)] ?? 0;
    return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top } as DOMRect;
  };
  return () => {
    for (const name of ["scrollHeight", "clientHeight"] as const) {
      const descriptor = original[name];
      if (descriptor) {
        Object.defineProperty(proto, name, descriptor);
      } else {
        delete (proto as Record<string, unknown>)[name];
      }
    }
    proto.getBoundingClientRect = original.getBoundingClientRect;
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function installResizeObserverMock() {
  const original = window.ResizeObserver;
  class MockResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {
      resizeObserverCallbacks.add(callback);
    }

    observe() {}

    unobserve() {}

    disconnect() {
      resizeObserverCallbacks.delete(this.callback);
    }
  }
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: MockResizeObserver
  });
  return () => {
    resizeObserverCallbacks.clear();
    if (original) {
      Object.defineProperty(window, "ResizeObserver", {
        configurable: true,
        writable: true,
        value: original
      });
      return;
    }
    delete (window as Partial<typeof window>).ResizeObserver;
  };
}

/** streamRun mock：按步骤回放一次运行，并在关键门点暂停，便于测试中途断言。 */
function scriptedRun() {
  const afterEcho = deferred();
  const afterDelta = deferred();
  const echo: Message = {
    id: "u2",
    sessionId: session.id,
    role: "user",
    content: "新问题",
    createdAt: "2026-06-08T00:00:03.000Z"
  };
  const answer: Message = {
    id: "a2",
    sessionId: session.id,
    role: "assistant",
    content: "新的回答",
    createdAt: "2026-06-08T00:00:04.000Z"
  };
  const streamRun = vi.fn(
    async (_input: unknown, onEvent: (event: StreamEvent) => void) => {
      onEvent({ type: "run_started", runId: "run_1", sessionId: session.id });
      onEvent({ type: "message", runId: "run_1", message: echo });
      await afterEcho.promise;
      onEvent({ type: "delta", runId: "run_1", channel: "text", delta: "流式片段" });
      await afterDelta.promise;
      onEvent({ type: "message", runId: "run_1", message: answer });
      onEvent({ type: "run_end", runId: "run_1", status: "completed" });
    }
  );
  return { streamRun, afterEcho, afterDelta };
}

function triggerScrollGeometryChange(): void {
  act(() => {
    for (const callback of resizeObserverCallbacks) {
      callback([], {} as ResizeObserver);
    }
    window.dispatchEvent(new Event("resize"));
  });
}

function mockElementRect(el: Element, rect: { top: number; height: number; width?: number }): void {
  const width = rect.width ?? 10;
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () =>
      ({
        top: rect.top,
        bottom: rect.top + rect.height,
        left: 0,
        right: width,
        width,
        height: rect.height,
        x: 0,
        y: rect.top
      }) as DOMRect
  });
}

describe("anchor-on-send scrolling", () => {
  let restoreMetrics: () => void;
  let restoreResizeObserver: () => void;

  beforeEach(() => {
    metrics.scrollHeight = 800;
    metrics.clientHeight = 300;
    metrics.rectTops = { "chat-scroll": 0 };
    restoreMetrics = installMetrics();
    restoreResizeObserver = installResizeObserverMock();
  });

  afterEach(() => {
    restoreResizeObserver();
    restoreMetrics();
  });

  it("opening a session scrolls to the bottom and keeps the spacer collapsed", async () => {
    render(<App client={createClient()} />);
    await screen.findByText("很长的回答");

    const scroller = screen.getByTestId("chat-scroll");
    await waitFor(() => expect(scroller.scrollTop).toBe(800));
    expect(screen.getByTestId("chat-tail-spacer").style.height).toBe("0px");
    expect(screen.queryByRole("button", { name: "回到底部" })).not.toBeInTheDocument();
  });

  it("shows the custom floating scroll progress when the chat overflows", async () => {
    render(<App client={createClient()} />);
    await screen.findByText("很长的回答");

    const progress = await screen.findByTestId("chat-scroll-progress");
    const thumb = screen.getByTestId("chat-scroll-progress-thumb");

    expect(progress).toHaveClass("chat-scroll-progress");
    expect(thumb).toHaveStyle({ height: "37.5%" });
  });

  it("drags the custom floating scroll progress to update chat scroll", async () => {
    render(<App client={createClient()} />);
    await screen.findByText("很长的回答");

    const scroller = screen.getByTestId("chat-scroll");
    await waitFor(() => expect(scroller.scrollTop).toBe(800));
    const progress = await screen.findByTestId("chat-scroll-progress");
    const thumb = screen.getByTestId("chat-scroll-progress-thumb");
    mockElementRect(progress, { top: 0, height: 300 });
    mockElementRect(thumb, { top: 0, height: 112.5 });

    scroller.scrollTop = 0;
    fireEvent.scroll(scroller);

    act(() => {
      fireEvent.pointerDown(thumb, { pointerId: 1, clientY: 10 });
      fireEvent.pointerMove(window, { pointerId: 1, clientY: 160 });
      fireEvent.pointerUp(window, { pointerId: 1, clientY: 160 });
    });

    expect(scroller.scrollTop).toBeCloseTo(400, 0);
    await waitFor(() => expect(thumb).toHaveStyle({ top: "50%" }));
  });

  it("does not move the chat scroll when the custom progress is only clicked", async () => {
    render(<App client={createClient()} />);
    await screen.findByText("很长的回答");

    const scroller = screen.getByTestId("chat-scroll");
    await waitFor(() => expect(scroller.scrollTop).toBe(800));
    const progress = await screen.findByTestId("chat-scroll-progress");
    const thumb = screen.getByTestId("chat-scroll-progress-thumb");
    mockElementRect(progress, { top: 0, height: 300 });
    mockElementRect(thumb, { top: 0, height: 112.5 });

    scroller.scrollTop = 120;
    fireEvent.scroll(scroller);

    act(() => {
      fireEvent.pointerDown(thumb, { pointerId: 1, clientY: 10 });
      fireEvent.pointerUp(window, { pointerId: 1, clientY: 10 });
    });

    expect(scroller.scrollTop).toBe(120);
  });

  it("keeps the current reading anchor when the chat column is resized", async () => {
    render(<App client={createClient()} />);
    await screen.findByText("很长的回答");

    const scroller = screen.getByTestId("chat-scroll");
    await waitFor(() => expect(scroller.scrollTop).toBe(800));

    metrics.scrollHeight = 1000;
    metrics.clientHeight = 300;
    metrics.rectTops = { "chat-scroll": 0, u1: -200, a1: 48 };
    scroller.scrollTop = 240;
    fireEvent.scroll(scroller);
    expect(screen.getByRole("button", { name: "回到底部" })).toBeInTheDocument();

    // 右侧面板打开/改宽会让聊天列重排；同一条消息相对视口下移 80px 时，
    // ChatView 应把 scrollTop 同步加回去，视觉上仍停在原位置。
    metrics.rectTops.a1 = 128;
    triggerScrollGeometryChange();

    expect(scroller.scrollTop).toBe(320);
    expect(screen.getByRole("button", { name: "回到底部" })).toBeInTheDocument();
  });

  it("sticks to the bottom when the chat column is resized at the bottom", async () => {
    render(<App client={createClient()} />);
    await screen.findByText("很长的回答");

    const scroller = screen.getByTestId("chat-scroll");
    await waitFor(() => expect(scroller.scrollTop).toBe(800));

    metrics.scrollHeight = 1000;
    metrics.clientHeight = 300;
    scroller.scrollTop = 700;
    fireEvent.scroll(scroller);
    expect(screen.queryByRole("button", { name: "回到底部" })).not.toBeInTheDocument();

    metrics.clientHeight = 280;
    triggerScrollGeometryChange();

    expect(scroller.scrollTop).toBe(720);
    expect(screen.queryByRole("button", { name: "回到底部" })).not.toBeInTheDocument();
  });

  it("anchors the just-sent user message to the viewport top", async () => {
    const client = createClient();
    const run = scriptedRun();
    client.streamRun = run.streamRun as ApiClient["streamRun"];
    render(<App client={client} />);
    await screen.findByText("很长的回答");
    const scroller = screen.getByTestId("chat-scroll");
    await waitFor(() => expect(scroller.scrollTop).toBe(800));

    // 回显后内容高度增长到 860px；新气泡矩形位于容器顶部下方 10px
    // (内容坐标 = 10 + 发送前 scrollTop 800 = 810)。
    metrics.scrollHeight = 860;
    metrics.rectTops.u2 = 10;
    let runPromise!: Promise<void>;
    act(() => {
      runPromise = useAppStore.getState().runPrompt("新问题");
    });

    await screen.findByText("新问题");
    expect(scroller.scrollTop).toBe(794);
    const spacer = screen.getByTestId("chat-tail-spacer");
    const spacerHeight = Number.parseInt(spacer.style.height, 10);
    const initialAnchorContentTop = contentTop(
      metrics.rectTops.u2,
      metrics.rectTops["chat-scroll"],
      800
    );
    const firstPassSpacer = tailSpacerHeight({
      anchorContentTop: initialAnchorContentTop,
      naturalScrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight
    });
    const recomputedSpacer = tailSpacerHeight({
      anchorContentTop: contentTop(
        metrics.rectTops.u2,
        metrics.rectTops["chat-scroll"],
        scroller.scrollTop
      ),
      naturalScrollHeight: scroller.scrollHeight - spacer.offsetHeight,
      clientHeight: scroller.clientHeight
    });
    expect(spacerHeight).toBeGreaterThanOrEqual(recomputedSpacer);
    expect(spacerHeight).toBeLessThanOrEqual(firstPassSpacer);
    expect(screen.queryByRole("button", { name: "回到底部" })).not.toBeInTheDocument();

    await act(async () => {
      run.afterEcho.resolve();
      run.afterDelta.resolve();
      await runPromise;
    });
  });

  it("auto-follows streamed output when the user has not scrolled away", async () => {
    const client = createClient();
    const run = scriptedRun();
    client.streamRun = run.streamRun as ApiClient["streamRun"];
    render(<App client={client} />);
    await screen.findByText("很长的回答");
    const scroller = screen.getByTestId("chat-scroll");
    await waitFor(() => expect(scroller.scrollTop).toBe(800));

    metrics.scrollHeight = 860;
    metrics.rectTops.u2 = 10;
    let runPromise!: Promise<void>;
    act(() => {
      runPromise = useAppStore.getState().runPrompt("新问题");
    });
    await screen.findByText("新问题");
    expect(scroller.scrollTop).toBe(794);

    // 流式内容超过锚点后的一屏空间后，视口应该跟到新的底部。
    metrics.scrollHeight = 1200;
    await act(async () => {
      run.afterEcho.resolve();
      await Promise.resolve();
    });
    await screen.findByText("流式片段");
    await waitFor(() => expect(scroller.scrollTop).toBe(900));
    expect(screen.queryByRole("button", { name: "回到底部" })).not.toBeInTheDocument();

    await act(async () => {
      run.afterDelta.resolve();
      await runPromise;
    });
  });

  it("pauses auto-follow when the user scrolls away during streaming", async () => {
    const client = createClient();
    const run = scriptedRun();
    client.streamRun = run.streamRun as ApiClient["streamRun"];
    render(<App client={client} />);
    await screen.findByText("很长的回答");
    const scroller = screen.getByTestId("chat-scroll");
    await waitFor(() => expect(scroller.scrollTop).toBe(800));

    metrics.scrollHeight = 860;
    metrics.rectTops.u2 = 10;
    let runPromise!: Promise<void>;
    act(() => {
      runPromise = useAppStore.getState().runPrompt("新问题");
    });
    await screen.findByText("新问题");

    // 用户在本轮运行中途向上滚动。
    scroller.scrollTop = 100;
    fireEvent.scroll(scroller);
    await screen.findByRole("button", { name: "回到底部" });

    // 后续流式增量不应把视口重新拽回底部。
    metrics.scrollHeight = 1200;
    await act(async () => {
      run.afterEcho.resolve();
      await Promise.resolve();
    });
    await screen.findByText("流式片段");
    expect(scroller.scrollTop).toBe(100);
    expect(screen.getByRole("button", { name: "回到底部" })).toBeInTheDocument();

    await act(async () => {
      run.afterDelta.resolve();
      await runPromise;
    });
  });

  it("pauses auto-follow when scroll position changes before the scroll handler runs", async () => {
    const client = createClient();
    const run = scriptedRun();
    client.streamRun = run.streamRun as ApiClient["streamRun"];
    render(<App client={client} />);
    await screen.findByText("很长的回答");
    const scroller = screen.getByTestId("chat-scroll");
    await waitFor(() => expect(scroller.scrollTop).toBe(800));

    metrics.scrollHeight = 860;
    metrics.rectTops.u2 = 10;
    let runPromise!: Promise<void>;
    act(() => {
      runPromise = useAppStore.getState().runPrompt("新问题");
    });
    await screen.findByText("新问题");
    expect(scroller.scrollTop).toBe(794);

    // 某些平台/时序下 scrollTop 已经变了，但 React scroll handler 还没来得及把 paused 写入。
    scroller.scrollTop = 100;
    metrics.scrollHeight = 1200;
    await act(async () => {
      run.afterEcho.resolve();
      await Promise.resolve();
    });
    await screen.findByText("流式片段");
    expect(scroller.scrollTop).toBe(100);
    expect(screen.getByRole("button", { name: "回到底部" })).toBeInTheDocument();

    await act(async () => {
      run.afterDelta.resolve();
      await runPromise;
    });
  });

  it("keeps a manual reading anchor during streaming resize without resuming auto-follow", async () => {
    const client = createClient();
    const run = scriptedRun();
    client.streamRun = run.streamRun as ApiClient["streamRun"];
    render(<App client={client} />);
    await screen.findByText("很长的回答");
    const scroller = screen.getByTestId("chat-scroll");
    await waitFor(() => expect(scroller.scrollTop).toBe(800));

    metrics.scrollHeight = 860;
    metrics.rectTops.u2 = 10;
    let runPromise!: Promise<void>;
    act(() => {
      runPromise = useAppStore.getState().runPrompt("新问题");
    });
    await screen.findByText("新问题");

    metrics.rectTops = { "chat-scroll": 0, u1: -220, a1: 60, u2: 260 };
    scroller.scrollTop = 100;
    fireEvent.scroll(scroller);
    await screen.findByRole("button", { name: "回到底部" });

    metrics.rectTops.a1 = 120;
    triggerScrollGeometryChange();
    expect(scroller.scrollTop).toBe(160);

    metrics.scrollHeight = 1200;
    await act(async () => {
      run.afterEcho.resolve();
      await Promise.resolve();
    });
    await screen.findByText("流式片段");
    expect(scroller.scrollTop).toBe(160);

    await act(async () => {
      run.afterDelta.resolve();
      await runPromise;
    });
  });

  it("pauses auto-follow when the user scrolls slightly upward near the bottom", async () => {
    const client = createClient();
    const run = scriptedRun();
    client.streamRun = run.streamRun as ApiClient["streamRun"];
    render(<App client={client} />);
    await screen.findByText("很长的回答");
    const scroller = screen.getByTestId("chat-scroll");
    await waitFor(() => expect(scroller.scrollTop).toBe(800));

    metrics.scrollHeight = 860;
    metrics.rectTops.u2 = 10;
    let runPromise!: Promise<void>;
    act(() => {
      runPromise = useAppStore.getState().runPrompt("新问题");
    });
    await screen.findByText("新问题");
    expect(scroller.scrollTop).toBe(794);

    // 距离底部仍在 120px 阈值内时，也应该尊重用户向上滚动的意图。
    scroller.scrollTop = 774;
    fireEvent.scroll(scroller);
    expect(screen.queryByRole("button", { name: "回到底部" })).not.toBeInTheDocument();

    metrics.scrollHeight = 1200;
    await act(async () => {
      run.afterEcho.resolve();
      await Promise.resolve();
    });
    await screen.findByText("流式片段");
    expect(scroller.scrollTop).toBe(774);
    expect(screen.getByRole("button", { name: "回到底部" })).toBeInTheDocument();

    await act(async () => {
      run.afterDelta.resolve();
      await runPromise;
    });
  });

  it("resumes auto-follow after clicking the scroll-to-bottom button", async () => {
    const client = createClient();
    const run = scriptedRun();
    client.streamRun = run.streamRun as ApiClient["streamRun"];
    render(<App client={client} />);
    await screen.findByText("很长的回答");
    const scroller = screen.getByTestId("chat-scroll");
    await waitFor(() => expect(scroller.scrollTop).toBe(800));

    metrics.scrollHeight = 860;
    metrics.rectTops.u2 = 10;
    let runPromise!: Promise<void>;
    act(() => {
      runPromise = useAppStore.getState().runPrompt("新问题");
    });
    await screen.findByText("新问题");

    scroller.scrollTop = 100;
    fireEvent.scroll(scroller);
    const button = await screen.findByRole("button", { name: "回到底部" });
    fireEvent.click(button);

    metrics.scrollHeight = 1200;
    await act(async () => {
      run.afterEcho.resolve();
      await Promise.resolve();
    });
    await screen.findByText("流式片段");
    await waitFor(() => expect(scroller.scrollTop).toBe(900));

    await act(async () => {
      run.afterDelta.resolve();
      await runPromise;
    });
  });

  it("resumes auto-follow when the user scrolls back near the bottom", async () => {
    const client = createClient();
    const run = scriptedRun();
    client.streamRun = run.streamRun as ApiClient["streamRun"];
    render(<App client={client} />);
    await screen.findByText("很长的回答");
    const scroller = screen.getByTestId("chat-scroll");
    await waitFor(() => expect(scroller.scrollTop).toBe(800));

    metrics.scrollHeight = 860;
    metrics.rectTops.u2 = 10;
    let runPromise!: Promise<void>;
    act(() => {
      runPromise = useAppStore.getState().runPrompt("新问题");
    });
    await screen.findByText("新问题");

    scroller.scrollTop = 100;
    fireEvent.scroll(scroller);
    await screen.findByRole("button", { name: "回到底部" });

    // 用户自己滚回底部阈值内后，下一段流式内容继续自动跟随。
    scroller.scrollTop = 560;
    fireEvent.scroll(scroller);
    metrics.scrollHeight = 1200;
    await act(async () => {
      run.afterEcho.resolve();
      await Promise.resolve();
    });
    await screen.findByText("流式片段");
    await waitFor(() => expect(scroller.scrollTop).toBe(900));

    await act(async () => {
      run.afterDelta.resolve();
      await runPromise;
    });
  });
});
