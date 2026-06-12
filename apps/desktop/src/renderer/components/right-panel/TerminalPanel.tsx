import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { createId } from "@chengxiaobang/shared";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { selectActiveProject, useAppStore } from "@/store";
import "@xterm/xterm/css/xterm.css";

const TERMINAL_FONT =
  "JetBrains Mono, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace";

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

/** 右侧真实 PTY 终端：main 进程持有 node-pty，renderer 只负责 xterm 渲染和输入转发。 */
export function TerminalPanel() {
  const { t } = useTranslation();
  const project = useAppStore(selectActiveProject);
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);

  useEffect(() => {
    if (!project || !hasTerminalBridge() || !containerRef.current) {
      return undefined;
    }
    const bridge = window.chengxiaobang;
    const terminalId = createId("pty");
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: false,
      fontFamily: TERMINAL_FONT,
      fontSize: 12,
      lineHeight: 1.45,
      scrollback: 5000,
      theme: {
        background: "#171717",
        foreground: "#f5f5f5",
        cursor: "#50e3c2",
        selectionBackground: "#d3e5ff55",
        black: "#171717",
        red: "#ee0000",
        green: "#0070f3",
        yellow: "#f5a623",
        blue: "#0070f3",
        magenta: "#7928ca",
        cyan: "#50e3c2",
        white: "#f5f5f5"
      }
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    terminal.focus();
    terminalRef.current = terminal;

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
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(() => {
            scheduleResize();
          });
    resizeObserver?.observe(containerRef.current);

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
        terminal.write(`\r\n${t("rightPanel.terminalExited", { code: event.exitCode })}\r\n`);
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
            `${t("rightPanel.terminalStartFailed", { message: result.error })}\r\n`
          );
        }
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      inputDisposable.dispose();
      offData?.();
      offExit?.();
      void bridge?.terminalClose?.(terminalId);
      terminal.dispose();
      if (terminalRef.current === terminal) {
        terminalRef.current = null;
      }
    };
  }, [project, t]);

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
    <div className="flex h-full min-h-0 flex-col bg-primary text-primary-foreground">
      <div
        ref={containerRef}
        aria-label={t("rightPanel.terminal")}
        className="min-h-0 flex-1 overflow-hidden px-3 py-3"
        onMouseDown={() => terminalRef.current?.focus()}
      />
    </div>
  );
}
