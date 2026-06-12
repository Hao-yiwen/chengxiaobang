import {
  ArrowUpIcon as ArrowUp,
  CaretDownIcon as ChevronDown,
  ChatTextIcon as MessageSquare,
  CheckIcon as Check,
  FilePlusIcon as FilePlus,
  FileTextIcon as FileText,
  FolderIcon as Folder,
  FolderOpenIcon as FolderOpen,
  ListChecksIcon as ListChecks,
  LockKeyIcon as LockKeyhole,
  PlusIcon as Plus,
  ShieldCheckIcon as ShieldCheck,
  SparkleIcon as Sparkles,
  SquareIcon as Square,
  TerminalWindowIcon as Terminal,
  XIcon as X
} from "@phosphor-icons/react";
import type { KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import {
  mergeProviderModelOptions,
  resolveProviderModelOption,
  type ProviderConfig,
  type ProviderModelOption,
  type ReasoningMode,
  type SlashCommand
} from "@chengxiaobang/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  reasoningModeLabel,
  reasoningModeSummary,
  supportedReasoningMode
} from "@/components/ProviderModelControls";
import { StampBadge } from "@/components/StampBadge";
import { cn } from "@/lib/utils";
import { getApiClient, selectActiveProject, useAppStore } from "@/store";

const TEXTAREA_MAX_HEIGHT_PX = 220;

export function Composer() {
  const { t } = useTranslation();
  const {
    value,
    projects,
    providers,
    providerId,
    model,
    reasoningMode,
    accessMode,
    planMode,
    pendingTool,
    attachments,
    isRunning,
    slashCommands
  } =
    useAppStore(
      useShallow((state) => ({
        value: state.input,
        projects: state.projects,
        providers: state.providers,
        providerId: state.providerId,
        model: state.model,
        reasoningMode: state.reasoningMode,
        accessMode: state.accessMode,
        planMode: state.planMode,
        pendingTool: state.pendingTool,
        attachments: state.attachments,
        isRunning: state.isRunning,
        slashCommands: state.slashCommands
      }))
    );
  const activeProject = useAppStore(selectActiveProject);
  const setInput = useAppStore((state) => state.setInput);
  const setProviderId = useAppStore((state) => state.setProviderId);
  const setModel = useAppStore((state) => state.setModel);
  const setReasoningMode = useAppStore((state) => state.setReasoningMode);
  const setAccessMode = useAppStore((state) => state.setAccessMode);
  const setPlanMode = useAppStore((state) => state.setPlanMode);
  const setActiveProjectId = useAppStore((state) => state.setActiveProjectId);
  const addContext = useAppStore((state) => state.addContext);
  const removeAttachment = useAppStore((state) => state.removeAttachment);
  const openFolder = useAppStore((state) => state.openFolder);
  const submit = useAppStore((state) => state.submit);
  const abortRun = useAppStore((state) => state.abortRun);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [selectionStart, setSelectionStart] = useState(0);
  const [highlightedCommand, setHighlightedCommand] = useState(0);
  const [modelOptionsByProvider, setModelOptionsByProvider] = useState<
    Record<string, ProviderModelOption[]>
  >({});
  const configuredProviders = providers.filter((provider) => provider.apiKeyRef);
  const selectedProvider =
    configuredProviders.find((provider) => provider.id === providerId) ?? configuredProviders[0];
  const selectedModel = selectedProvider ? model ?? selectedProvider.model : undefined;
  const selectedModelOption =
    selectedProvider && selectedModel
      ? resolveProviderModelOption(selectedProvider.kind, selectedModel)
      : undefined;
  const selectedReasoningMode = selectedProvider
    ? supportedReasoningMode(
        selectedProvider.kind,
        selectedModel ?? selectedProvider.model,
        reasoningMode ?? selectedProvider.reasoningMode
      )
    : undefined;
  const hasReasoningSummary =
    selectedModelOption !== undefined &&
    (selectedModelOption.reasoningModes.length > 0 || selectedModelOption.reasoningAlwaysOn === true);
  const configuredProviderKey = configuredProviders
    .map((provider) => `${provider.id}:${provider.kind}:${provider.model}:${provider.updatedAt}`)
    .join("|");
  const awaitingAskUser = isRunning && pendingTool?.name === "ask_user";
  const slashQuery = getSlashQuery(value, selectionStart);
  const filteredSlashCommands = useMemo(
    () => filterSlashCommands(slashCommands, slashQuery ?? ""),
    [slashCommands, slashQuery]
  );
  const showSlashMenu = slashQuery !== undefined && filteredSlashCommands.length > 0;

  // 项目会话里的 @ 文件引用；按 Escape 会隐藏当前 @ token 的建议。
  const [dismissedAtStart, setDismissedAtStart] = useState<number>();
  const fileSuggestions = useAppStore((state) => state.fileSuggestions);
  const loadFileSuggestions = useAppStore((state) => state.loadFileSuggestions);
  const atToken = activeProject ? getAtToken(value, selectionStart) : undefined;
  const showFileMenu =
    !showSlashMenu &&
    atToken !== undefined &&
    atToken.start !== dismissedAtStart &&
    fileSuggestions.length > 0;
  // 未配置供应商时也允许触发提交，store 会打开首次配置弹窗。
  const canSend = value.trim().length > 0;

  useEffect(() => {
    setHighlightedCommand(0);
  }, [slashQuery, filteredSlashCommands.length, atToken?.query, fileSuggestions.length]);

  useEffect(() => {
    const client = getApiClient();
    if (!client || configuredProviders.length === 0) {
      setModelOptionsByProvider({});
      return;
    }
    let cancelled = false;
    void Promise.all(
      configuredProviders.map(async (provider) => {
        try {
          if (typeof client.listProviderModelOptions !== "function") {
            return [
              provider.id,
              mergeProviderModelOptions(provider.kind, [], provider.model)
            ] as const;
          }
          const options = await client.listProviderModelOptions(provider.id);
          return [provider.id, options] as const;
        } catch (error) {
          console.warn("[composer] 拉取模型选项失败，使用静态目录", {
            providerId: provider.id,
            error
          });
          return [
            provider.id,
            mergeProviderModelOptions(provider.kind, [], provider.model)
          ] as const;
        }
      })
    ).then((entries) => {
      if (!cancelled) {
        setModelOptionsByProvider(Object.fromEntries(entries));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [configuredProviderKey]);

  // 输入 @ token 时防抖拉取项目文件建议。
  useEffect(() => {
    if (atToken === undefined) {
      return;
    }
    const query = atToken.query;
    const timer = window.setTimeout(() => void loadFileSuggestions(query), 150);
    return () => window.clearTimeout(timer);
  }, [atToken?.query, atToken === undefined, loadFileSuggestions]);

  // 输入框随内容增长，但限制最大高度，避免挤压页面。
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

  // 模型与推理强度联动：切换模型时仅保留新模型仍支持的推理模式。
  const selectComposerModel = (provider: ProviderConfig, nextModel: string) => {
    const nextReasoningMode = supportedReasoningMode(
      provider.kind,
      nextModel,
      reasoningMode ?? provider.reasoningMode
    );
    console.info("[composer] 切换模型", {
      providerId: provider.id,
      model: nextModel,
      reasoningMode: nextReasoningMode
    });
    setProviderId(provider.id);
    setModel(nextModel === provider.model ? undefined : nextModel);
    setReasoningMode(nextReasoningMode);
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
    // Shift+Tab 切换计划模式（与 ＋ 菜单里的开关同源）。
    if (event.key === "Tab" && event.shiftKey) {
      event.preventDefault();
      setPlanMode(!planMode);
      return;
    }
    // 斜杠菜单和文件菜单共用键盘交互；两者同时命中时优先斜杠菜单。
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
    // Enter 提交，Shift+Enter 换行；中文输入法合成中不拦截。
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      (!isRunning || awaitingAskUser)
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
      className="relative w-full rounded-xl border border-border bg-card transition-colors focus-within:border-form-focus"
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
        placeholder={awaitingAskUser ? t("composer.askUserWaiting") : t("composer.placeholder")}
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
        <div
          aria-label={t("composer.slashMenuLabel")}
          className="animate-scale-in absolute bottom-full left-0 right-0 z-20 mb-2 overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-overlay"
        >
          <div className="max-h-[260px] overflow-y-auto py-1">
            {filteredSlashCommands.map((command, index) => (
              <button
                key={command.id}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left text-body-sm transition-colors",
                  index === highlightedCommand ? "bg-accent text-accent-foreground" : "hover:bg-accent"
                )}
                onMouseEnter={() => setHighlightedCommand(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  insertSlashCommand(command);
                }}
                onClick={() => insertSlashCommand(command)}
              >
                <span className="flex size-7 flex-none items-center justify-center rounded-xs bg-canvas-soft-2 text-muted-foreground">
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
                {command.kind === "skill" ? (
                  <StampBadge
                    text={t("composer.kindSkill")}
                    fullLabel={t("composer.kindSkillFull")}
                    tone="indigo"
                  />
                ) : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {showFileMenu ? (
        <div
          aria-label={t("composer.fileMenuLabel")}
          className="animate-scale-in absolute bottom-full left-0 right-0 z-20 mb-2 overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-overlay"
        >
          <div className="max-h-[260px] overflow-y-auto py-1">
            {fileSuggestions.map((path, index) => (
              <button
                key={path}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left text-body-sm transition-colors",
                  index === highlightedCommand ? "bg-accent text-accent-foreground" : "hover:bg-accent"
                )}
                onMouseEnter={() => setHighlightedCommand(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  insertFileReference(path);
                }}
                onClick={() => insertFileReference(path)}
              >
                <span className="flex size-7 flex-none items-center justify-center rounded-xs bg-canvas-soft-2 text-muted-foreground">
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title={t("composer.addContext")}
              className="size-8 rounded-sm text-foreground hover:bg-canvas-soft-2"
            >
              <Plus className="size-[19px]" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[200px]">
            <DropdownMenuItem onSelect={() => setPlanMode(!planMode)}>
              <ListChecks className="size-4 text-muted-foreground" />
              <span className="flex-1">{t("composer.planModeFull")}</span>
              <Switch
                checked={planMode}
                aria-hidden
                tabIndex={-1}
                className="pointer-events-none data-[state=checked]:bg-link"
              />
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void addContext()}>
              <FilePlus className="size-4 text-muted-foreground" />
              {t("composer.addFile")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 rounded-sm px-2.5 text-micro font-normal text-foreground hover:bg-canvas-soft-2"
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

        {planMode ? (
          <button
            type="button"
            title={t("composer.planModeOff")}
            onClick={() => setPlanMode(false)}
            className="flex h-8 items-center gap-1.5 rounded-sm px-2.5 text-micro font-normal text-link transition-colors hover:bg-link/10"
          >
            <ListChecks className="size-4" />
            {t("composer.planModeFull")}
          </button>
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 rounded-sm px-2.5 text-micro font-normal text-foreground hover:bg-canvas-soft-2"
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
                <span className="block font-medium">{t("permission.approval")}</span>
                <span className="mt-0.5 block text-caption leading-snug text-muted-foreground">
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
                <span className="block font-medium">{t("permission.fullAccess")}</span>
                <span className="mt-0.5 block text-caption leading-snug text-muted-foreground">
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

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t("composer.selectModel")}
              disabled={configuredProviders.length === 0}
              className="h-8 max-w-[280px] gap-1.5 rounded-sm px-2.5 text-micro font-normal text-foreground hover:bg-canvas-soft-2"
            >
              <span className="truncate">
                {selectedModelOption
                  ? modelOptionLabel(selectedModelOption)
                  : selectedModel ?? t("composer.selectModel")}
              </span>
              {hasReasoningSummary ? " " : null}
              {hasReasoningSummary && selectedModelOption ? (
                <span className="flex-none text-muted-foreground">
                  · {reasoningModeSummary(t, selectedModelOption, selectedReasoningMode)}
                </span>
              ) : null}
              <ChevronDown className="size-3.5 flex-none" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[280px]">
            {configuredProviders.map((provider, index) => {
              const options = withCurrentComposerModel(
                provider,
                modelOptionsByProvider[provider.id],
                provider.id === selectedProvider?.id ? selectedModel : undefined
              );
              return (
                <DropdownMenuGroup key={provider.id}>
                  {index > 0 ? <DropdownMenuSeparator /> : null}
                  <DropdownMenuLabel>{provider.name}</DropdownMenuLabel>
                  {options.map((option) => (
                    <DropdownMenuItem
                      key={`${provider.id}::${option.id}`}
                      onSelect={(event) => {
                        // 选模型不关菜单：下方推理段随所选模型联动，可接着调推理强度。
                        event.preventDefault();
                        selectComposerModel(provider, option.id);
                      }}
                    >
                      <Check
                        className={cn(
                          "size-4 flex-none",
                          provider.id === selectedProvider?.id && option.id === selectedModel
                            ? "opacity-100"
                            : "opacity-0"
                        )}
                      />
                      <span className="truncate">{modelOptionLabel(option)}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              );
            })}
            {selectedModelOption ? (
              <DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{t("settings.providers.reasoning")}</DropdownMenuLabel>
                {selectedModelOption.reasoningModes.length === 0 ? (
                  <DropdownMenuItem disabled>
                    <Check className="size-4 flex-none opacity-0" />
                    {selectedModelOption.reasoningAlwaysOn
                      ? t("settings.providers.reasoningAlwaysOn")
                      : t("settings.providers.reasoningDefault")}
                  </DropdownMenuItem>
                ) : (
                  <>
                    <DropdownMenuItem onSelect={() => setReasoningMode(undefined)}>
                      <Check
                        className={cn(
                          "size-4 flex-none",
                          selectedReasoningMode === undefined ? "opacity-100" : "opacity-0"
                        )}
                      />
                      {t("settings.providers.reasoningDefault")}
                    </DropdownMenuItem>
                    {selectedModelOption.reasoningModes.map((mode) => (
                      <DropdownMenuItem key={mode} onSelect={() => setReasoningMode(mode)}>
                        <Check
                          className={cn(
                            "size-4 flex-none",
                            selectedReasoningMode === mode ? "opacity-100" : "opacity-0"
                          )}
                        />
                        {reasoningModeLabel(t, mode)}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
              </DropdownMenuGroup>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>

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
 * 光标前正在输入的 @ token：`@src/uti` -> { query, start of "@" }。
 * token 必须位于输入开头或空白字符之后，且内部不能包含空白或另一个 @。
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

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function withCurrentComposerModel(
  provider: ProviderConfig,
  remoteOptions: ProviderModelOption[] | undefined,
  selectedModel: string | undefined
): ProviderModelOption[] {
  const fallback = mergeProviderModelOptions(provider.kind, provider.models ?? [], provider.model);
  let options = remoteOptions && remoteOptions.length > 0 ? remoteOptions : fallback;
  // 供应商配置了启用模型列表时，菜单只展示启用的模型。
  if (provider.models && provider.models.length > 0) {
    const enabled = new Set(provider.models);
    options = options.filter((option) => enabled.has(option.id));
  }
  const currentModel = selectedModel ?? provider.model;
  if (options.some((option) => option.id === currentModel)) {
    return options;
  }
  return [...options, resolveProviderModelOption(provider.kind, currentModel)];
}

function modelOptionLabel(option: ProviderModelOption): string {
  return option.label ?? option.id;
}
