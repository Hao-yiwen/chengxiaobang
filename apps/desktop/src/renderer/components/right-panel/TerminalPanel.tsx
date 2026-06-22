import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { selectActiveProject, useAppStore } from "@/store";
import "@xterm/xterm/css/xterm.css";

const TERMINAL_FONT =
  "JetBrains Mono, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace";

const TERMINAL_THEME_FALLBACKS = {
  canvas: "255 255 255",
  ink: "23 23 23",
  body: "77 77 77",
  mute: "136 136 136",
  hairline: "235 235 235",
  link: "0 112 243",
  linkBgSoft: "211 229 255",
  softBlue: "64 118 190",
  softBlueStrong: "38 88 152",
  softBlueForeground: "45 83 135",
  error: "238 0 0",
  warning: "245 166 35",
  violet: "121 40 202"
} as const;

function hasTerminalBridge(): boolean {
  const bridge = window.chengxiaobang;
  return Boolean(
    bridge?.terminalStart &&
      bridge.terminalWrite &&
      bridge.terminalResize &&
      bridge.terminalClose &&
      bridge.onTerminalData &&
      bridge.onTerminalExit
  );
}

function createTerminalTheme(): ITheme {
  const style = getComputedStyle(document.documentElement);
  const canvas = tokenColor(style, "--canvas", TERMINAL_THEME_FALLBACKS.canvas);
  const ink = tokenColor(style, "--ink", TERMINAL_THEME_FALLBACKS.ink);
  const body = tokenColor(style, "--body", TERMINAL_THEME_FALLBACKS.body);
  const mute = tokenColor(style, "--mute", TERMINAL_THEME_FALLBACKS.mute);
  const hairline = tokenColor(style, "--border", TERMINAL_THEME_FALLBACKS.hairline);
  const link = tokenColor(style, "--link", TERMINAL_THEME_FALLBACKS.link);
  const linkBgSoft = tokenColor(style, "--link-bg-soft", TERMINAL_THEME_FALLBACKS.linkBgSoft);
  const softBlue = tokenColor(style, "--soft-blue", TERMINAL_THEME_FALLBACKS.softBlue);
  const softBlueStrong = tokenColor(
    style,
    "--soft-blue-strong",
    TERMINAL_THEME_FALLBACKS.softBlueStrong
  );
  const softBlueForeground = tokenColor(
    style,
    "--soft-blue-foreground",
    TERMINAL_THEME_FALLBACKS.softBlueForeground
  );
  const error = tokenColor(style, "--error", TERMINAL_THEME_FALLBACKS.error);
  const warning = tokenColor(style, "--warning", TERMINAL_THEME_FALLBACKS.warning);
  const violet = tokenColor(style, "--violet", TERMINAL_THEME_FALLBACKS.violet);

  return {
    background: rgb(canvas),
    foreground: rgb(ink),
    cursor: rgb(softBlue),
    cursorAccent: rgb(canvas),
    selectionBackground: rgba(linkBgSoft, 0.72),
    selectionForeground: rgb(ink),
    selectionInactiveBackground: rgba(linkBgSoft, 0.42),
    scrollbarSliderBackground: rgba(mute, 0.22),
    scrollbarSliderHoverBackground: rgba(mute, 0.34),
    scrollbarSliderActiveBackground: rgba(mute, 0.46),
    overviewRulerBorder: rgb(hairline),
    black: rgb(ink),
    red: rgb(error),
    green: rgb(link),
    yellow: rgb(warning),
    blue: rgb(link),
    magenta: rgb(violet),
    cyan: rgb(softBlueForeground),
    white: rgb(body),
    brightBlack: rgb(mute),
    brightRed: rgb(error),
    brightGreen: rgb(softBlue),
    brightYellow: rgb(warning),
    brightBlue: rgb(softBlueStrong),
    brightMagenta: rgb(violet),
    brightCyan: rgb(softBlue),
    brightWhite: rgb(ink)
  };
}

function tokenColor(style: CSSStyleDeclaration, variable: string, fallback: string): string {
  const rawValue =
    style.getPropertyValue(variable).trim() ||
    document.documentElement.style.getPropertyValue(variable).trim();
  const parsed = parseRgbToken(rawValue);
  if (parsed) {
    return parsed;
  }
  const fallbackColor = parseRgbToken(fallback) ?? "255, 255, 255";
  console.warn("[terminal] 主题变量缺失或格式异常，使用回退色", {
    variable,
    value: rawValue,
    fallback
  });
  return fallbackColor;
}

function parseRgbToken(value: string): string | undefined {
  const match = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})$/.exec(value);
  if (!match) {
    return undefined;
  }
  return `${match[1]}, ${match[2]}, ${match[3]}`;
}

function rgb(value: string): string {
  return `rgb(${value})`;
}

function rgba(value: string, alpha: number): string {
  return `rgba(${value}, ${alpha})`;
}

interface TerminalPanelProps {
  /** 来自 tab 的稳定 PTY id:切 tab 不重建,关 tab 才销毁。 */
  terminalId: string;
  /** 当前 tab 是否可见;隐藏时容器尺寸为 0,需在重新可见时主动 fit。 */
  visible: boolean;
}

/** 右侧真实 PTY 终端：main 进程持有 node-pty，renderer 只负责 xterm 渲染和输入转发。 */
export function TerminalPanel({ terminalId, visible }: TerminalPanelProps) {
  const { t } = useTranslation();
  const project = useAppStore(selectActiveProject);
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  // t 只用于退出/启动失败的文案;用 ref 持有最新 t,避免它进入下方 effect 依赖——否则切换
  // 界面语言会重建 PTY,丢掉当前终端会话、滚动缓冲与运行中的命令。
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    if (!project || !hasTerminalBridge() || !containerRef.current) {
      return undefined;
    }
    const bridge = window.chengxiaobang;
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: false,
      fontFamily: TERMINAL_FONT,
      fontSize: 12,
      lineHeight: 1.45,
      scrollback: 5000,
      theme: createTerminalTheme()
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    terminal.focus();
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    let disposed = false;
    let frame = 0;
    const resizePty = () => {
      if (disposed) {
        return;
      }
      try {
        fitAddon.fit();
        void bridge?.terminalResize?.(terminalId, terminal.cols, terminal.rows);
      } catch (error) {
        console.warn("[terminal] xterm 尺寸计算失败:", error);
      }
    };
    const scheduleResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(resizePty);
    };
    const applyTerminalTheme = () => {
      try {
        terminal.options.theme = createTerminalTheme();
      } catch (error) {
        console.warn("[terminal] 应用 xterm 主题失败", {
          terminalId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    };
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(() => {
            scheduleResize();
          });
    resizeObserver?.observe(containerRef.current);
    const themeObserver =
      typeof MutationObserver === "undefined"
        ? undefined
        : new MutationObserver(() => {
            applyTerminalTheme();
          });
    themeObserver?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"]
    });

    const inputDisposable = terminal.onData((data) => {
      void bridge?.terminalWrite?.(terminalId, data);
    });
    const offData = bridge?.onTerminalData?.((event) => {
      if (event.id === terminalId) {
        terminal.write(event.data);
      }
    });
    const offExit = bridge?.onTerminalExit?.((event) => {
      if (event.id === terminalId) {
        terminal.write(`\r\n${tRef.current("rightPanel.terminalExited", { code: event.exitCode })}\r\n`);
      }
    });

    scheduleResize();
    void bridge
      ?.terminalStart?.({
        id: terminalId,
        cwd: project.path,
        cols: terminal.cols,
        rows: terminal.rows
      })
      .then((result) => {
        if (!result.ok && !disposed) {
          terminal.write(
            `${tRef.current("rightPanel.terminalStartFailed", { message: result.error })}\r\n`
          );
        }
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      themeObserver?.disconnect();
      inputDisposable.dispose();
      offData?.();
      offExit?.();
      void bridge?.terminalClose?.(terminalId);
      terminal.dispose();
      if (terminalRef.current === terminal) {
        terminalRef.current = null;
      }
      if (fitAddonRef.current === fitAddon) {
        fitAddonRef.current = null;
      }
    };
    // 故意不依赖 t:文案通过 tRef 读取最新值,语言切换不应重建终端。
    // 依赖 terminalId:同一 tab 的 id 稳定,切 tab(hidden 切显隐)不重建,只有真正卸载(关 tab)才销毁 PTY。
  }, [project, terminalId]);

  // 隐藏期间容器尺寸为 0,ResizeObserver 不可靠;重新可见时主动 fit 一次并聚焦。
  useEffect(() => {
    if (!visible) {
      return undefined;
    }
    const frame = requestAnimationFrame(() => {
      const terminal = terminalRef.current;
      const fitAddon = fitAddonRef.current;
      if (!terminal || !fitAddon) {
        return;
      }
      try {
        fitAddon.fit();
        void window.chengxiaobang?.terminalResize?.(terminalId, terminal.cols, terminal.rows);
        terminal.focus();
      } catch (error) {
        console.warn("[terminal] 重新可见时 fit 失败", {
          terminalId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, terminalId]);

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-caption text-muted-foreground">
        {t("rightPanel.terminalNoProject")}
      </div>
    );
  }

  if (!hasTerminalBridge()) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-caption text-muted-foreground">
        {t("rightPanel.terminalUnsupported")}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas text-foreground">
      <div
        ref={containerRef}
        aria-label={t("rightPanel.terminal")}
        className="min-h-0 flex-1 overflow-hidden px-3 py-3 [&_.composition-view]:!bg-canvas [&_.composition-view]:!text-foreground [&_.xterm-viewport]:!bg-canvas [&_.xterm]:!bg-canvas [&_.xterm]:!text-foreground"
        onMouseDown={() => terminalRef.current?.focus()}
      />
    </div>
  );
}
