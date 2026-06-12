import {
  CheckIcon as Check,
  CircleNotchIcon as Loader2,
  NotePencilIcon as SquarePen,
  XIcon as X
} from "@phosphor-icons/react";
import { useEffect, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Markdown } from "@/components/Markdown";
import { StreamingMarkdown } from "@/components/StreamingMarkdown";
import { ToolCallRow } from "@/components/ToolCallRow";
import { Button } from "@/components/ui/button";
import { initialSideChatState, sideChatReducer } from "@/lib/side-chat";
import {
  getApiClient,
  resolveRunProvider,
  selectActiveProject,
  useAppStore
} from "@/store";

/**
 * A standalone mini chat in the right panel: its own session (created by the
 * first run), streaming replies, tool rows and a compact approval bar. It
 * never touches the main view's run state.
 */
export function SideChatPanel() {
  const { t } = useTranslation();
  const project = useAppStore(selectActiveProject);
  const provider = useAppStore(resolveRunProvider);
  const accessMode = useAppStore((state) => state.accessMode);
  const model = useAppStore((state) => state.model);
  const [state, dispatch] = useReducer(sideChatReducer, initialSideChatState);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [state.items, state.streamText, state.pendingTool]);

  async function send(): Promise<void> {
    const client = getApiClient();
    const prompt = input.trim();
    if (!client || !prompt || state.running) {
      return;
    }
    if (!provider) {
      useAppStore.getState().setOnboardingOpen(true);
      return;
    }
    setInput("");
    dispatch({ type: "send" });
    try {
      await client.streamRun(
        {
          sessionId: state.sessionId,
          projectId: project?.id ?? null,
          prompt,
          providerId: provider.id,
          accessMode,
          planMode: false,
          ...(model ? { model } : {})
        },
        (event) => dispatch({ type: "event", event })
      );
      dispatch({ type: "finish" });
      // Surface the (possibly new) session in the left session list.
      void useAppStore.getState().loadData();
    } catch (error) {
      console.error("[side-chat] 运行流中断:", error);
      dispatch({ type: "finish", error: error instanceof Error ? error.message : String(error) });
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  }

  const pendingTool = state.pendingTool;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none items-center justify-end border-b px-3 py-2">
        <button
          type="button"
          disabled={state.running}
          onClick={() => dispatch({ type: "reset" })}
          className="flex items-center gap-1.5 rounded-xs px-2 py-1 text-micro text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <SquarePen className="size-3.5" />
          {t("rightPanel.chatNew")}
        </button>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto p-3">
        {state.items.length === 0 && !state.streamText ? (
          <p className="px-1 py-2 text-caption text-muted-foreground">
            {t("rightPanel.chatEmpty")}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {state.items.map((item) =>
              item.kind === "message" ? (
                item.message.role === "user" ? (
                  <div
                    key={item.message.id}
                    className="self-end rounded-sm bg-canvas-soft-2 px-3 py-2 text-caption text-foreground"
                  >
                    <span className="whitespace-pre-wrap break-words">{item.message.content}</span>
                  </div>
                ) : (
                  <Markdown key={item.message.id} text={item.message.content} />
                )
              ) : (
                <ToolCallRow key={item.toolCall.id} toolCall={item.toolCall} />
              )
            )}
            {state.streamText ? <StreamingMarkdown text={state.streamText} className="stream-caret" /> : null}
            {state.running && !state.streamText && !pendingTool ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : null}
          </div>
        )}
        {pendingTool ? (
          <div className="mt-3 overflow-hidden rounded-sm border bg-card">
            <div className="border-b bg-canvas-soft-2/70 px-3 py-2 font-mono text-micro font-medium uppercase tracking-[0.28px]">
              {pendingTool.name}
            </div>
            <div className="flex flex-col gap-2 p-3">
              <pre className="max-h-[160px] overflow-auto rounded-sm bg-muted px-2.5 py-2 font-mono text-micro leading-relaxed text-muted-foreground">
                {JSON.stringify(pendingTool.args, null, 2)}
              </pre>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => void getApiClient()?.approve(pendingTool.id, { approved: true })}
                >
                  <Check className="size-4" />
                  {t("chat.run")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void getApiClient()?.approve(pendingTool.id, { approved: false })}
                >
                  <X className="size-4" />
                  {t("chat.reject")}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
        {state.error ? (
          <p className="mt-3 px-1 text-micro text-destructive">{state.error}</p>
        ) : null}
      </div>
      <div className="flex-none border-t px-3 py-2.5">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("rightPanel.chatPlaceholder")}
          aria-label={t("rightPanel.chatPlaceholder")}
          spellCheck={false}
          className="h-8 w-full rounded-xs border bg-card px-2.5 text-caption outline-none transition-colors focus:border-form-focus"
        />
      </div>
    </div>
  );
}
