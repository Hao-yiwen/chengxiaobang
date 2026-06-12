import {
  ArrowUp,
  Check,
  ChevronDown,
  FileText,
  Folder,
  FolderOpen,
  LockKeyhole,
  MessageSquare,
  Plus,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  X
} from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import type { SlashCommand } from "@chengxiaobang/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { selectActiveProject, useAppStore } from "@/store";

const TEXTAREA_MAX_HEIGHT_PX = 220;

export function Composer() {
  const { t } = useTranslation();
  const { value, projects, providers, providerId, accessMode, attachments, isRunning, slashCommands } =
    useAppStore(
      useShallow((state) => ({
        value: state.input,
        projects: state.projects,
        providers: state.providers,
        providerId: state.providerId,
        accessMode: state.accessMode,
        attachments: state.attachments,
        isRunning: state.isRunning,
        slashCommands: state.slashCommands
      }))
    );
  const activeProject = useAppStore(selectActiveProject);
  const setInput = useAppStore((state) => state.setInput);
  const setProviderId = useAppStore((state) => state.setProviderId);
  const setAccessMode = useAppStore((state) => state.setAccessMode);
  const setActiveProjectId = useAppStore((state) => state.setActiveProjectId);
  const addContext = useAppStore((state) => state.addContext);
  const removeAttachment = useAppStore((state) => state.removeAttachment);
  const openFolder = useAppStore((state) => state.openFolder);
  const submit = useAppStore((state) => state.submit);
  const abortRun = useAppStore((state) => state.abortRun);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [selectionStart, setSelectionStart] = useState(0);
  const [highlightedCommand, setHighlightedCommand] = useState(0);
  const configuredProviders = providers.filter((provider) => provider.apiKeyRef);
  const selectedProvider = configuredProviders.find((provider) => provider.id === providerId);
  const slashQuery = getSlashQuery(value, selectionStart);
  const filteredSlashCommands = useMemo(
    () => filterSlashCommands(slashCommands, slashQuery ?? ""),
    [slashCommands, slashQuery]
  );
  const showSlashMenu = slashQuery !== undefined && filteredSlashCommands.length > 0;

  // @-file mentions (project sessions only). Escape hides the menu for the
  // token at this position until a new @ starts.
  const [dismissedAtStart, setDismissedAtStart] = useState<number>();
  const fileSuggestions = useAppStore((state) => state.fileSuggestions);
  const loadFileSuggestions = useAppStore((state) => state.loadFileSuggestions);
  const atToken = activeProject ? getAtToken(value, selectionStart) : undefined;
  const showFileMenu =
    !showSlashMenu &&
    atToken !== undefined &&
    atToken.start !== dismissedAtStart &&
    fileSuggestions.length > 0;
  // Allow sending with no provider configured — the store opens the setup
  // dialog instead of silently doing nothing.
  const canSend = value.trim().length > 0;

  useEffect(() => {
    setHighlightedCommand(0);
  }, [slashQuery, filteredSlashCommands.length, atToken?.query, fileSuggestions.length]);

  // Debounced fetch of file suggestions while an @-token is being typed.
  useEffect(() => {
    if (atToken === undefined) {
      return;
    }
    const query = atToken.query;
    const timer = window.setTimeout(() => void loadFileSuggestions(query), 150);
    return () => window.clearTimeout(timer);
  }, [atToken?.query, atToken === undefined, loadFileSuggestions]);

  // ChatGPT-style auto-growing textarea: expand with content up to a cap.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, TEXTAREA_MAX_HEIGHT_PX)}px`;
  }, [value]);

  const updateSelectionStart = () => {
    setSelectionStart(textareaRef.current?.selectionStart ?? value.length);
  };

  const insertSlashCommand = (command: SlashCommand) => {
    setInput(command.insertText);
    setHighlightedCommand(0);
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) {
        return;
      }
      textarea.focus();
      textarea.setSelectionRange(command.insertText.length, command.insertText.length);
      setSelectionStart(command.insertText.length);
    });
  };

  const insertFileReference = (path: string) => {
    if (atToken === undefined) {
      return;
    }
    const cursor = Math.max(0, Math.min(selectionStart, value.length));
    const next = `${value.slice(0, atToken.start)}@${path} ${value.slice(cursor)}`;
    setInput(next);
    setHighlightedCommand(0);
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) {
        return;
      }
      const caret = atToken.start + path.length + 2;
      textarea.focus();
      textarea.setSelectionRange(caret, caret);
      setSelectionStart(caret);
    });
  };

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Both menus share one keyboard interaction; slash wins when both could show.
    const menu = showSlashMenu ? "slash" : showFileMenu ? "file" : undefined;
    if (menu) {
      const menuLength = menu === "slash" ? filteredSlashCommands.length : fileSuggestions.length;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlightedCommand((index) => (index + 1) % menuLength);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlightedCommand((index) => (index - 1 + menuLength) % menuLength);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        if (menu === "slash") {
          insertSlashCommand(filteredSlashCommands[highlightedCommand] ?? filteredSlashCommands[0]);
        } else {
          insertFileReference(fileSuggestions[highlightedCommand] ?? fileSuggestions[0]);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (menu === "slash") {
          textareaRef.current?.setSelectionRange(value.length, value.length);
          setSelectionStart(value.length);
        } else if (atToken !== undefined) {
          setDismissedAtStart(atToken.start);
        }
        return;
      }
    }
    // Enter sends (Shift+Enter inserts a newline); respect IME composition.
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      !isRunning
    ) {
      event.preventDefault();
      if (canSend) {
        void submit();
      }
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      void submit();
    }
  };

  return (
    <div
      data-testid="composer-shell"
      className="relative w-full rounded-lg border border-border bg-card transition-colors focus-within:border-form-focus"
    >
      {attachments.length > 0 ? (
        <div className="flex flex-wrap gap-2 px-4 pt-3.5">
          {attachments.map((attachment) => (
            <Badge
              key={attachment.path}
              variant="secondary"
              className="max-w-[240px] gap-1.5 py-1 pl-2.5 pr-1 font-normal"
              title={attachment.path}
            >
              <span className="truncate">{attachment.name}</span>
              <span className="flex-none text-micro text-muted-foreground">
                {formatSize(attachment.size)}
              </span>
              <button
                type="button"
                aria-label={t("composer.removeAttachment", { name: attachment.name })}
                onClick={() => removeAttachment(attachment.path)}
                className="flex size-4 items-center justify-center rounded-xs text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}

      <Textarea
        ref={textareaRef}
        rows={1}
        aria-label={t("composer.messageLabel")}
        placeholder={t("composer.placeholder")}
        value={value}
        onChange={(event) => {
          setInput(event.target.value);
          setSelectionStart(event.target.selectionStart);
        }}
        onClick={updateSelectionStart}
        onKeyUp={updateSelectionStart}
        onSelect={updateSelectionStart}
        onKeyDown={handleTextareaKeyDown}
        className="max-h-[220px] min-h-[68px] resize-none overflow-y-auto rounded-none border-0 bg-transparent px-4 pb-3 pt-3.5 text-body focus-visible:border-transparent focus-visible:ring-0"
      />

      {showSlashMenu ? (
        <div className="animate-scale-in absolute bottom-full left-0 right-0 z-20 mb-2 overflow-hidden rounded-sm border bg-popover text-popover-foreground shadow-overlay">
          <div className="max-h-[260px] overflow-y-auto py-1">
            {filteredSlashCommands.map((command, index) => (
              <button
                key={command.id}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left text-caption transition-colors",
                  index === highlightedCommand ? "bg-accent text-accent-foreground" : "hover:bg-accent"
                )}
                onMouseEnter={() => setHighlightedCommand(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  insertSlashCommand(command);
                }}
                onClick={() => insertSlashCommand(command)}
              >
                <span className="flex size-7 flex-none items-center justify-center rounded-xs bg-soft-stone text-muted-foreground">
                  {command.kind === "builtin_tool" ? (
                    <Terminal className="size-4" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{command.name}</span>
                  <span className="block truncate text-micro text-muted-foreground">
                    {command.description || t("composer.slashNoDescription")}
                  </span>
                </span>
                <span className="flex-none rounded-xs border px-1.5 py-0.5 text-micro text-muted-foreground">
                  {t(`composer.slashSource.${command.source}`)}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {showFileMenu ? (
        <div
          aria-label={t("composer.fileMenuLabel")}
          className="animate-scale-in absolute bottom-full left-0 right-0 z-20 mb-2 overflow-hidden rounded-sm border bg-popover text-popover-foreground shadow-overlay"
        >
          <div className="max-h-[260px] overflow-y-auto py-1">
            {fileSuggestions.map((path, index) => (
              <button
                key={path}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left text-caption transition-colors",
                  index === highlightedCommand ? "bg-accent text-accent-foreground" : "hover:bg-accent"
                )}
                onMouseEnter={() => setHighlightedCommand(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  insertFileReference(path);
                }}
                onClick={() => insertFileReference(path)}
              >
                <span className="flex size-7 flex-none items-center justify-center rounded-xs bg-soft-stone text-muted-foreground">
                  <FileText className="size-4" />
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-micro">{path}</span>
                <span className="flex-none rounded-xs border px-1.5 py-0.5 text-micro text-muted-foreground">
                  {t("composer.atFileTag")}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-1 px-2.5 pb-2.5 pt-0 [&_svg]:stroke-[1.75]">
        <IconButton title={t("composer.addContext")} onClick={() => void addContext()}>
          <Plus className="size-[19px]" />
        </IconButton>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 rounded-xs px-2.5 text-micro font-normal text-muted-foreground hover:bg-soft-stone hover:text-foreground"
            >
              <Folder className="size-4" />
              <span className="max-w-[180px] truncate">
                {activeProject?.name ?? t("composer.conversationMode")}
              </span>
              <ChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[220px]">
            <DropdownMenuItem onSelect={() => setActiveProjectId(undefined)}>
              <Check
                className={cn("size-4", activeProject ? "opacity-0" : "opacity-100")}
              />
              <MessageSquare className="size-4 text-muted-foreground" />
              {t("composer.conversationMode")}
            </DropdownMenuItem>
            {projects.length > 0 ? <DropdownMenuSeparator /> : null}
            {projects.map((project) => (
              <DropdownMenuItem key={project.id} onSelect={() => setActiveProjectId(project.id)}>
                <Check
                  className={cn(
                    "size-4",
                    project.id === activeProject?.id ? "opacity-100" : "opacity-0"
                  )}
                />
                <span className="truncate">{project.name}</span>
              </DropdownMenuItem>
            ))}
            {projects.length > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem onSelect={() => void openFolder()}>
              <FolderOpen className="size-4 text-muted-foreground" />
              {t("composer.openFolderEllipsis")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 rounded-xs px-2.5 text-micro font-normal text-muted-foreground hover:bg-soft-stone hover:text-foreground"
            >
              {accessMode === "full_access" ? (
                <ShieldCheck className="size-4" />
              ) : (
                <LockKeyhole className="size-4" />
              )}
              {t(accessMode === "full_access" ? "permission.fullAccess" : "permission.approval")}
              <ChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[280px]">
            <DropdownMenuItem
              className="items-start gap-2.5 py-2.5"
              onSelect={() => setAccessMode("approval")}
            >
              <LockKeyhole className="mt-0.5 size-4 flex-none text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block text-caption font-medium">{t("permission.approval")}</span>
                <span className="mt-0.5 block text-micro leading-snug text-muted-foreground">
                  {t("settings.general.approvalDesc")}
                </span>
              </span>
              <Check
                className={cn(
                  "mt-0.5 size-4 flex-none",
                  accessMode === "approval" ? "opacity-100" : "opacity-0"
                )}
              />
            </DropdownMenuItem>
            <DropdownMenuItem
              className="items-start gap-2.5 py-2.5"
              onSelect={() => setAccessMode("full_access")}
            >
              <ShieldCheck className="mt-0.5 size-4 flex-none text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block text-caption font-medium">{t("permission.fullAccess")}</span>
                <span className="mt-0.5 block text-micro leading-snug text-muted-foreground">
                  {t("settings.general.fullDesc")}
                </span>
              </span>
              <Check
                className={cn(
                  "mt-0.5 size-4 flex-none",
                  accessMode === "full_access" ? "opacity-100" : "opacity-0"
                )}
              />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex-1" />

        <Select
          value={selectedProvider?.id ?? ""}
          onValueChange={setProviderId}
          disabled={configuredProviders.length === 0}
        >
          <SelectTrigger
            aria-label={t("composer.selectModel")}
            className="h-8 w-auto max-w-[220px] gap-1.5 rounded-xs border-0 bg-transparent px-2.5 text-micro font-normal text-muted-foreground hover:bg-soft-stone hover:text-foreground focus:border-transparent focus:ring-0"
          >
            <SelectValue placeholder={t("composer.selectModel")}>
              {selectedProvider ? selectedProvider.model : null}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {configuredProviders.map((provider) => (
              <SelectItem key={provider.id} value={provider.id}>
                {provider.name} · {provider.model}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {isRunning ? (
          <Button
            size="icon"
            className="size-8 rounded-sm bg-primary text-primary-foreground hover:bg-primary/85"
            title={t("composer.stop")}
            onClick={() => void abortRun()}
          >
            <Square className="size-3.5 fill-current" />
          </Button>
        ) : (
          <Button
            size="icon"
            className="size-8 rounded-sm bg-primary text-primary-foreground transition-opacity hover:bg-primary/85 disabled:bg-muted disabled:text-muted-foreground"
            title={t("composer.send")}
            disabled={!canSend}
            onClick={() => void submit()}
          >
            <ArrowUp className="size-[18px]" />
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * The @-token being typed at the cursor: `@src/uti` -> { query, start of "@" }.
 * The token must start the input or follow whitespace and may not contain
 * whitespace or another @.
 */
export function getAtToken(
  value: string,
  selectionStart: number
): { query: string; start: number } | undefined {
  const cursor = Math.max(0, Math.min(selectionStart, value.length));
  const before = value.slice(0, cursor);
  const match = before.match(/(^|\s)@([^\s@]*)$/);
  if (!match) {
    return undefined;
  }
  return { query: match[2], start: cursor - match[2].length - 1 };
}

function getSlashQuery(value: string, selectionStart: number): string | undefined {
  if (!value.startsWith("/")) {
    return undefined;
  }
  const cursor = Math.max(0, Math.min(selectionStart, value.length));
  const beforeCursor = value.slice(0, cursor);
  if (beforeCursor.includes("\n")) {
    return undefined;
  }
  const firstLine = value.split("\n", 1)[0] ?? "";
  if (cursor > firstLine.length) {
    return undefined;
  }
  return beforeCursor.slice(1).toLowerCase();
}

function filterSlashCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  const compactQuery = query.trim();
  if (!compactQuery) {
    return commands;
  }
  return commands.filter((command) =>
    `${command.name} ${command.description}`.toLowerCase().includes(compactQuery)
  );
}

function IconButton(props: {
  title: string;
  disabled?: boolean;
  className?: string;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("size-8 rounded-xs text-muted-foreground hover:bg-soft-stone hover:text-foreground", props.className)}
          disabled={props.disabled}
          onClick={props.onClick}
        >
          {props.children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{props.title}</TooltipContent>
    </Tooltip>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
