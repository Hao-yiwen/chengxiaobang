import {
  ArrowUp,
  Check,
  ChevronDown,
  Folder,
  FolderOpen,
  LockKeyhole,
  MessageSquare,
  Mic,
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
import { useVoiceInput } from "@/lib/use-voice-input";

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
  const voice = useVoiceInput({ value, onChange: setInput });
  const configuredProviders = providers.filter((provider) => provider.apiKeyRef);
  const selectedProvider = configuredProviders.find((provider) => provider.id === providerId);
  const slashQuery = getSlashQuery(value, selectionStart);
  const filteredSlashCommands = useMemo(
    () => filterSlashCommands(slashCommands, slashQuery ?? ""),
    [slashCommands, slashQuery]
  );
  const showSlashMenu = slashQuery !== undefined && filteredSlashCommands.length > 0;
  // Allow sending with no provider configured — the store opens the setup
  // dialog instead of silently doing nothing.
  const canSend = value.trim().length > 0;

  useEffect(() => {
    setHighlightedCommand(0);
  }, [slashQuery, filteredSlashCommands.length]);

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

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlashMenu) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlightedCommand((index) => (index + 1) % filteredSlashCommands.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlightedCommand(
          (index) => (index - 1 + filteredSlashCommands.length) % filteredSlashCommands.length
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        insertSlashCommand(filteredSlashCommands[highlightedCommand] ?? filteredSlashCommands[0]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        textareaRef.current?.setSelectionRange(value.length, value.length);
        setSelectionStart(value.length);
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
    <div className="relative w-full rounded-[26px] border bg-card shadow-composer transition-[border-color,box-shadow] focus-within:border-input focus-within:shadow-elevated">
      {attachments.length > 0 ? (
        <div className="flex flex-wrap gap-2 px-4 pt-3.5">
          {attachments.map((attachment) => (
            <Badge
              key={attachment.path}
              variant="secondary"
              className="max-w-[240px] gap-1.5 rounded-lg py-1 pl-2.5 pr-1 font-normal"
              title={attachment.path}
            >
              <span className="truncate">{attachment.name}</span>
              <span className="flex-none text-[11px] text-muted-foreground">
                {formatSize(attachment.size)}
              </span>
              <button
                type="button"
                aria-label={t("composer.removeAttachment", { name: attachment.name })}
                onClick={() => removeAttachment(attachment.path)}
                className="flex size-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
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
        className="max-h-[220px] min-h-[44px] resize-none overflow-y-auto rounded-none border-0 bg-transparent px-4 pb-0 pt-3.5 text-[15px] leading-relaxed shadow-none focus-visible:ring-0"
      />

      {showSlashMenu ? (
        <div className="animate-scale-in absolute bottom-full left-2 right-2 z-20 mb-2 overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-elevated">
          <div className="max-h-[260px] overflow-y-auto py-1">
            {filteredSlashCommands.map((command, index) => (
              <button
                key={command.id}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors",
                  index === highlightedCommand ? "bg-accent text-accent-foreground" : "hover:bg-accent"
                )}
                onMouseEnter={() => setHighlightedCommand(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  insertSlashCommand(command);
                }}
                onClick={() => insertSlashCommand(command)}
              >
                <span className="flex size-7 flex-none items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  {command.kind === "builtin_tool" ? (
                    <Terminal className="size-4" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{command.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {command.description || t("composer.slashNoDescription")}
                  </span>
                </span>
                <span className="flex-none rounded-md border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  {t(`composer.slashSource.${command.source}`)}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-1 px-2.5 pb-2.5 pt-1.5 [&_svg]:stroke-[1.75]">
        <IconButton title={t("composer.addContext")} onClick={() => void addContext()}>
          <Plus className="size-[19px]" />
        </IconButton>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 rounded-full px-2.5 text-[12.5px] font-normal text-muted-foreground hover:text-foreground"
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
              className="h-8 gap-1.5 rounded-full px-2.5 text-[12.5px] font-normal text-muted-foreground hover:text-foreground"
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
                <span className="block text-[13px] font-medium">{t("permission.approval")}</span>
                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
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
                <span className="block text-[13px] font-medium">{t("permission.fullAccess")}</span>
                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
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
            className="h-8 w-auto max-w-[220px] gap-1.5 rounded-full border-0 bg-transparent px-2.5 text-[12.5px] font-normal text-muted-foreground shadow-none hover:bg-accent hover:text-foreground focus:ring-0"
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

        <IconButton
          title={
            voice.state === "unsupported"
              ? t("composer.voiceUnsupported")
              : voice.state === "listening"
                ? t("composer.voiceStop")
                : t("composer.voiceStart")
          }
          disabled={voice.state === "unsupported"}
          onClick={voice.toggle}
          className={cn(
            voice.state === "listening" &&
              "animate-mic-pulse bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive"
          )}
        >
          <Mic className="size-[17px]" />
        </IconButton>

        {isRunning ? (
          <Button
            size="icon"
            className="size-8 rounded-full bg-primary text-primary-foreground hover:bg-primary/85"
            title={t("composer.stop")}
            onClick={() => void abortRun()}
          >
            <Square className="size-3.5 fill-current" />
          </Button>
        ) : (
          <Button
            size="icon"
            className="size-8 rounded-full bg-primary text-primary-foreground transition-opacity hover:bg-primary/85 disabled:bg-muted disabled:text-muted-foreground"
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
          className={cn("size-8 rounded-full text-muted-foreground hover:text-foreground", props.className)}
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
