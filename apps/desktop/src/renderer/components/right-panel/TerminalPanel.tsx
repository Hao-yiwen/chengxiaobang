import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { selectActiveProject, useAppStore } from "@/store";

/**
 * A lightweight command runner (no PTY): each entry is one command executed
 * in the active project directory via the backend's /api/terminal/exec.
 */
export function TerminalPanel() {
  const { t } = useTranslation();
  const entries = useAppStore((state) => state.terminalEntries);
  const running = useAppStore((state) => state.terminalRunning);
  const runTerminalCommand = useAppStore((state) => state.runTerminalCommand);
  const project = useAppStore(selectActiveProject);
  const [input, setInput] = useState("");
  const [historyIndex, setHistoryIndex] = useState<number | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [entries]);

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-caption text-muted-foreground">
        {t("rightPanel.terminalNoProject")}
      </div>
    );
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!input.trim() || running) {
        return;
      }
      void runTerminalCommand(input);
      setInput("");
      setHistoryIndex(undefined);
      return;
    }
    const commands = entries.map((entry) => entry.command);
    if (event.key === "ArrowUp" && commands.length > 0) {
      event.preventDefault();
      const next = historyIndex === undefined ? commands.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(next);
      setInput(commands[next] ?? "");
    }
    if (event.key === "ArrowDown" && historyIndex !== undefined) {
      event.preventDefault();
      const next = historyIndex + 1;
      if (next >= commands.length) {
        setHistoryIndex(undefined);
        setInput("");
      } else {
        setHistoryIndex(next);
        setInput(commands[next] ?? "");
      }
    }
  }

  return (
    // DESIGN.md agent-console / dark-feature-band: a deep-green console field.
    <div className="flex h-full min-h-0 flex-col bg-deep-green text-white">
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-micro leading-relaxed"
      >
        <p className="mb-2 truncate text-white/50" title={project.path}>
          {project.path}
        </p>
        {entries.length === 0 ? (
          <p className="text-white/60">{t("rightPanel.terminalEmpty")}</p>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="mb-3">
              <div className="flex items-center gap-2 font-medium text-white">
                <span className="select-none text-white/50">$</span>
                <span className="min-w-0 break-all">{entry.command}</span>
                {entry.output === undefined ? (
                  <Loader2 className="size-3 flex-none animate-spin text-white/60" />
                ) : null}
              </div>
              {entry.output ? (
                <pre className="mt-1 whitespace-pre-wrap break-words text-white/80">
                  {entry.output}
                </pre>
              ) : null}
              {entry.exitCode !== undefined && entry.exitCode !== 0 ? (
                <p className="mt-1 text-coral-soft">
                  {t("rightPanel.exitCode", { code: entry.exitCode })}
                </p>
              ) : null}
            </div>
          ))
        )}
      </div>
      <div className="flex flex-none items-center gap-2 border-t border-white/15 px-4 py-2.5 font-mono text-micro">
        <span className="select-none text-white/50">$</span>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("rightPanel.terminalPlaceholder")}
          aria-label={t("rightPanel.terminalPlaceholder")}
          spellCheck={false}
          className="h-7 w-full bg-transparent font-mono text-micro text-white caret-coral outline-none placeholder:text-white/40"
        />
      </div>
    </div>
  );
}
