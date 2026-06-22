import {
  CheckMediumIcon,
  CopyIcon,
  EllipsisHorizontalIcon,
  PencilOutlineIcon,
  PinFilledSmallIcon,
  PinOutlineIcon,
  PullRequestOpenIcon
} from "@/assets/file-type-icons";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Message, Session } from "@chengxiaobang/shared";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buildSessionMarkdown } from "@/lib/session-export";
import { useAppStore } from "@/store";

export function SessionActionsMenu({ session }: { session: Session }) {
  const { t } = useTranslation();
  const messages = useAppStore((state) => state.messages);
  const toolHistory = useAppStore((state) => state.toolHistory);
  const isRunning = useAppStore((state) => state.isRunning);
  const setSessionPinned = useAppStore((state) => state.setSessionPinned);
  const renameSession = useAppStore((state) => state.renameSession);
  const forkSession = useAppStore((state) => state.forkSession);
  const setNotice = useAppStore((state) => state.setNotice);
  const [renameOpen, setRenameOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState(session.title);
  const [copiedKey, setCopiedKey] = useState<"title" | "sessionId" | "markdown" | undefined>();

  const lastMessage = useMemo(() => latestForkableMessage(messages), [messages]);
  const forkDisabled = isRunning;

  async function copyText(kind: "title" | "sessionId" | "markdown", text: string): Promise<void> {
    if (!navigator.clipboard?.writeText) {
      console.warn("[session-actions-menu] 复制失败：当前环境没有剪贴板能力", {
        sessionId: session.id,
        kind
      });
      setNotice(t("sessionMenu.copyFailed"));
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(kind);
      window.setTimeout(() => setCopiedKey(undefined), 1500);
      console.debug("[session-actions-menu] 已复制会话内容", {
        sessionId: session.id,
        kind
      });
    } catch (error) {
      console.warn("[session-actions-menu] 复制会话内容失败", {
        sessionId: session.id,
        kind,
        error: error instanceof Error ? error.message : String(error)
      });
      setNotice(t("sessionMenu.copyFailed"));
    }
  }

  function markdownForCopy(): string {
    return buildSessionMarkdown(session, messages, toolHistory, {
      user: t("chat.roleUser"),
      assistant: t("chat.roleAssistant"),
      toolCall: t("export.toolCall"),
      reasoning: t("export.reasoning"),
      exportedAt: t("export.exportedAt")
    });
  }

  async function commitRename(): Promise<void> {
    const title = draftTitle.trim();
    if (!title) {
      return;
    }
    console.info("[session-actions-menu] 重命名当前会话", {
      sessionId: session.id,
      title
    });
    await renameSession(session.id, title);
    setRenameOpen(false);
  }

  async function forkFrom(message: Message | undefined): Promise<void> {
    if (!message || forkDisabled) {
      return;
    }
    console.info("[session-actions-menu] 从当前会话创建分支", {
      sessionId: session.id,
      messageId: message.id,
      source: "last"
    });
    await forkSession(message.id);
  }

  return (
    <>
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) {
            console.debug("[session-actions-menu] 打开会话操作菜单", {
              sessionId: session.id
            });
          }
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("sessionMenu.open")}
            className="flex size-8 flex-none items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-canvas-soft-2 hover:text-foreground data-[state=open]:bg-canvas-soft-2 data-[state=open]:text-foreground"
          >
            <EllipsisHorizontalIcon className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={8} className="min-w-[220px]">
          <DropdownMenuItem
            onSelect={() => {
              console.info("[session-actions-menu] 切换当前会话置顶", {
                sessionId: session.id,
                pinned: !session.pinnedAt
              });
              void setSessionPinned(session.id, !session.pinnedAt);
            }}
          >
            {session.pinnedAt ? (
              <PinFilledSmallIcon className="size-4" />
            ) : (
              <PinOutlineIcon className="size-4" />
            )}
            <span>{session.pinnedAt ? t("sessionMenu.unpin") : t("sessionMenu.pin")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setDraftTitle(session.title);
              window.setTimeout(() => setRenameOpen(true), 0);
            }}
          >
            <PencilOutlineIcon className="size-4" />
            <span>{t("sessionMenu.rename")}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <CopyIcon className="size-4" />
              <span>{t("sessionMenu.copy")}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-[180px]">
              <DropdownMenuItem onSelect={() => void copyText("sessionId", session.id)}>
                {copiedKey === "sessionId" ? (
                  <CheckMediumIcon className="size-4" />
                ) : (
                  <CopyIcon className="size-4" />
                )}
                <span>{t("sessionMenu.copySessionId")}</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void copyText("title", session.title)}>
                {copiedKey === "title" ? (
                  <CheckMediumIcon className="size-4" />
                ) : (
                  <CopyIcon className="size-4" />
                )}
                <span>{t("sessionMenu.copyTitle")}</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void copyText("markdown", markdownForCopy())}>
                {copiedKey === "markdown" ? (
                  <CheckMediumIcon className="size-4" />
                ) : (
                  <CopyIcon className="size-4" />
                )}
                <span>{t("sessionMenu.copyMarkdown")}</span>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <PullRequestOpenIcon className="size-4" />
              <span>{t("sessionMenu.branch")}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-[190px]">
              <DropdownMenuItem
                disabled={forkDisabled || !lastMessage}
                onSelect={() => void forkFrom(lastMessage)}
              >
                <PullRequestOpenIcon className="size-4" />
                <span>{t("sessionMenu.branchLastMessage")}</span>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("sessionMenu.renameDialogTitle")}</DialogTitle>
            <DialogDescription>{t("sessionMenu.renameDialogDescription")}</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            aria-label={t("sessionMenu.renameInputLabel")}
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && draftTitle.trim()) {
                event.preventDefault();
                void commitRename();
              }
            }}
          />
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setRenameOpen(false)}>
              {t("sessionMenu.cancel")}
            </Button>
            <Button size="sm" disabled={!draftTitle.trim()} onClick={() => void commitRename()}>
              {t("sessionMenu.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function latestForkableMessage(messages: Message[]): Message | undefined {
  return [...messages].reverse().find((message) => message.kind !== "compaction_summary");
}
