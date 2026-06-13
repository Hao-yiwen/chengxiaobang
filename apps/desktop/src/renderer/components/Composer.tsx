import {
  ArrowUpIcon as ArrowUp,
  CaretDownIcon as ChevronDown,
  CheckIcon as Check,
  FileAudioIcon as FileAudio,
  FileCodeIcon as FileCode,
  FileDocIcon as FileDoc,
  FileIcon as FileAttachment,
  FileImageIcon as FileImage,
  FilePdfIcon as FilePdf,
  FilePlusIcon as FilePlus,
  FilePptIcon as FilePpt,
  FileTextIcon as FileText,
  FileVideoIcon as FileVideo,
  FileXlsIcon as FileSpreadsheet,
  FolderDashedIcon as FolderDashed,
  FolderIcon as Folder,
  FolderOpenIcon as FolderOpen,
  ListChecksIcon as ListChecks,
  LockKeyIcon as LockKeyhole,
  MagnifyingGlassIcon as Search,
  PlusIcon as Plus,
  ShieldCheckIcon as ShieldCheck,
  SparkleIcon as Sparkles,
  SquareIcon as Square,
  XIcon as X,
  type Icon
} from "@phosphor-icons/react";
import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import {
  mergeProviderModelOptions,
  resolveProviderModelOption,
  type AccessMode,
  type ProviderConfig,
  type ProviderModelOption,
  type ReasoningMode,
  type SessionContextUsage,
  type SlashCommand
} from "@chengxiaobang/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
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
// 占位文案轮播：单行高度需与 text-body 行高（24px）一致，便于 translateY 对齐。
const ROTATION_LINE_HEIGHT_PX = 24;
const ROTATION_INTERVAL_MS = 2800;
const ATTACHMENT_CARD_TEXT_PREVIEW_BYTES = 1600;

const ACCESS_MODE_TONES: Record<
  AccessMode,
  { trigger: string; menuIcon: string; check: string; hover: string }
> = {
  approval: {
    trigger: "text-muted-foreground",
    menuIcon: "text-muted-foreground",
    check: "text-muted-foreground",
    hover: "hover:bg-canvas-soft-2"
  },
  smart_approval: {
    trigger: "text-link",
    menuIcon: "text-link",
    check: "text-link",
    hover: "hover:bg-link-bg-soft/45"
  },
  full_access: {
    trigger: "text-[#d25f28]",
    menuIcon: "text-[#d25f28]",
    check: "text-[#d25f28]",
    hover: "hover:bg-[#d25f28]/10"
  }
};

export function Composer() {
  const { t } = useTranslation();
  const {
    value,
    activeSessionId,
    messageCount,
    lastMessageId,
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
    activeRunId,
    activeRunClientRequestId,
    lastUsageKey,
    slashCommands,
    view
  } =
    useAppStore(
      useShallow((state) => ({
        value: state.input,
        view: state.view,
        activeSessionId: state.activeSessionId,
        messageCount: state.messages.length,
        lastMessageId: state.messages[state.messages.length - 1]?.id,
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
        activeRunId: state.activeRunId,
        activeRunClientRequestId: state.activeRunClientRequestId,
        lastUsageKey: state.lastUsage
          ? [
              state.lastUsage.promptTokens,
              state.lastUsage.completionTokens,
              state.lastUsage.totalTokens,
              state.lastUsage.costUsd ?? ""
            ].join(":")
          : "",
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
  const openSkills = useAppStore((state) => state.openSkills);
  const removeAttachment = useAppStore((state) => state.removeAttachment);
  const openFilePreview = useAppStore((state) => state.openFilePreview);
  const openFolder = useAppStore((state) => state.openFolder);
  const createBlankProject = useAppStore((state) => state.createBlankProject);
  const submit = useAppStore((state) => state.submit);
  const abortRun = useAppStore((state) => state.abortRun);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const suggestionAnchorRef = useRef<HTMLDivElement | null>(null);
  const highlightInnerRef = useRef<HTMLDivElement | null>(null);
  const [selectionStart, setSelectionStart] = useState(0);
  const [suggestionMenuWidth, setSuggestionMenuWidth] = useState<number>();
  // 首页占位文案轮播：内置多行文案做上下滚动切换。
  const placeholderRotationRaw = t("composer.placeholderRotation", { returnObjects: true });
  const placeholderRotation = Array.isArray(placeholderRotationRaw)
    ? (placeholderRotationRaw as string[])
    : [];
  const [rotationIndex, setRotationIndex] = useState(0);
  const rotationIndexRef = useRef(0);
  const [rotationSnap, setRotationSnap] = useState(false);
  // 项目选择器：搜索词 + 新建空白项目命名弹窗。
  const [projectQuery, setProjectQuery] = useState("");
  const [blankDialogOpen, setBlankDialogOpen] = useState(false);
  const [blankName, setBlankName] = useState("");
  const [creatingBlank, setCreatingBlank] = useState(false);
  const filteredProjects = useMemo(() => {
    const query = projectQuery.trim().toLowerCase();
    if (!query) {
      return projects;
    }
    return projects.filter((project) => project.name.toLowerCase().includes(query));
  }, [projects, projectQuery]);
  const [highlightedCommand, setHighlightedCommand] = useState(0);
  const [modelOptionsByProvider, setModelOptionsByProvider] = useState<
    Record<string, ProviderModelOption[]>
  >({});
  const [contextUsage, setContextUsage] = useState<SessionContextUsage>();
  const [contextUsageLoading, setContextUsageLoading] = useState(false);
  const [contextUsageError, setContextUsageError] = useState<string>();
  const configuredProviders = providers.filter((provider) => provider.apiKeyRef);
  const selectedProvider =
    configuredProviders.find((provider) => provider.id === providerId) ?? configuredProviders[0];
  const selectedModel = selectedProvider ? model ?? selectedProvider.model : undefined;
  const selectedModelOption =
    selectedProvider && selectedModel
      ? resolveProviderModelOption(selectedProvider.kind, selectedModel)
      : undefined;
  const accessTone = ACCESS_MODE_TONES[accessMode];
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
  const currentComposerRunning =
    view !== "home" && isRunning && (Boolean(activeRunId) || Boolean(activeRunClientRequestId));
  const awaitingAskUser = currentComposerRunning && pendingTool?.name === "ask_user";
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
  const activeSuggestionMenu = showSlashMenu ? "slash" : showFileMenu ? "file" : undefined;
  // 已插入的斜杠命令 / @ 文件引用打灰底标记，与普通输入区分。
  const highlightRanges = useMemo(
    () => getComposerHighlightRanges(value, slashCommands, Boolean(activeProject)),
    [value, slashCommands, activeProject]
  );
  // 未配置供应商时也允许触发提交，store 会打开首次配置弹窗。
  const canSend = value.trim().length > 0 || attachments.length > 0;
  // 仅首页、输入框为空且非运行/等待回答时，用轮播文案替代静态占位。
  const rotatingActive =
    view === "home" &&
    !currentComposerRunning &&
    !awaitingAskUser &&
    value.length === 0 &&
    placeholderRotation.length > 1;

  useEffect(() => {
    setHighlightedCommand(0);
  }, [slashQuery, filteredSlashCommands.length, atToken?.query, fileSuggestions.length]);

  useEffect(() => {
    if (!activeSuggestionMenu) {
      return;
    }
    const anchor = suggestionAnchorRef.current;
    if (!anchor) {
      return;
    }
    const updateWidth = () => {
      const width = anchor.getBoundingClientRect().width;
      if (width > 0) {
        setSuggestionMenuWidth(width);
      }
    };
    updateWidth();
    const ResizeObserverCtor = window.ResizeObserver;
    if (!ResizeObserverCtor) {
      window.addEventListener("resize", updateWidth);
      return () => window.removeEventListener("resize", updateWidth);
    }
    const observer = new ResizeObserverCtor(updateWidth);
    observer.observe(anchor);
    window.addEventListener("resize", updateWidth);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateWidth);
    };
  }, [activeSuggestionMenu]);

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

  useEffect(() => {
    const client = getApiClient();
    if (!client?.getSessionContextUsage || !activeSessionId || !selectedProvider || !selectedModel) {
      setContextUsage(undefined);
      setContextUsageLoading(false);
      setContextUsageError(undefined);
      return;
    }
    let cancelled = false;
    setContextUsageLoading(true);
    setContextUsageError(undefined);
    // 守卫已收窄，但闭包内会丢失对可选方法的窄化，先取出来。
    const getSessionContextUsage = client.getSessionContextUsage;
    const timer = window.setTimeout(() => {
      void getSessionContextUsage(activeSessionId, {
          providerId: selectedProvider.id,
          model: selectedModel,
          ...(selectedReasoningMode ? { reasoningMode: selectedReasoningMode } : {}),
          planMode
        })
        .then((usage) => {
          if (!cancelled) {
            setContextUsage(usage);
            setContextUsageError(undefined);
          }
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }
          const message = error instanceof Error ? error.message : String(error);
          console.warn("[composer] 刷新上下文用量失败", {
            sessionId: activeSessionId,
            providerId: selectedProvider.id,
            model: selectedModel,
            error: message
          });
          setContextUsageError(message);
        })
        .finally(() => {
          if (!cancelled) {
            setContextUsageLoading(false);
          }
        });
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    activeSessionId,
    lastMessageId,
    lastUsageKey,
    messageCount,
    planMode,
    selectedModel,
    selectedProvider?.id,
    selectedReasoningMode
  ]);

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
    // 高度变化可能改变滚动位置，同步 highlight overlay。
    if (highlightInnerRef.current) {
      highlightInnerRef.current.style.transform = `translateY(-${textarea.scrollTop}px)`;
    }
  }, [value]);

  useEffect(() => {
    rotationIndexRef.current = rotationIndex;
  }, [rotationIndex]);

  // 占位文案轮播：用单次 timeout 续约，窗口后台/隐藏时暂停，避免恢复后补跑多个 tick。
  useEffect(() => {
    if (!rotatingActive) {
      rotationIndexRef.current = 0;
      setRotationIndex(0);
      setRotationSnap(false);
      return;
    }

    let disposed = false;
    let timer: number | undefined;
    let windowFocused = true;
    const isPaused = () => document.visibilityState === "hidden" || !windowFocused;
    const clearTimer = () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
    };
    const snapOverflowIndex = () => {
      if (rotationIndexRef.current < placeholderRotation.length) {
        return false;
      }
      rotationIndexRef.current = 0;
      setRotationSnap(true);
      setRotationIndex(0);
      return true;
    };
    const scheduleNext = () => {
      clearTimer();
      if (disposed || isPaused()) {
        return;
      }
      timer = window.setTimeout(() => {
        timer = undefined;
        if (disposed || isPaused()) {
          return;
        }
        if (snapOverflowIndex()) {
          scheduleNext();
          return;
        }
        const nextIndex = rotationIndexRef.current + 1;
        rotationIndexRef.current = nextIndex;
        setRotationIndex(nextIndex);
        setRotationSnap(false);
        scheduleNext();
      }, ROTATION_INTERVAL_MS);
    };
    const pauseRotation = (reason: string) => {
      clearTimer();
      console.debug("[composer] 暂停首页占位文案轮播", {
        reason,
        index: rotationIndexRef.current
      });
    };
    const resumeRotation = (reason: string) => {
      if (isPaused()) {
        return;
      }
      snapOverflowIndex();
      console.debug("[composer] 恢复首页占位文案轮播", {
        reason,
        index: rotationIndexRef.current
      });
      scheduleNext();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        pauseRotation("document_hidden");
        return;
      }
      resumeRotation("document_visible");
    };
    const handleWindowBlur = () => {
      windowFocused = false;
      pauseRotation("window_blur");
    };
    const handleWindowFocus = () => {
      windowFocused = true;
      resumeRotation("window_focus");
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("focus", handleWindowFocus);
    scheduleNext();
    return () => {
      disposed = true;
      clearTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [rotatingActive, placeholderRotation.length]);

  // 滚到末尾的复制行后，无动画瞬回首行，形成无缝循环。
  const handleRotationTransitionEnd = () => {
    if (rotationIndex >= placeholderRotation.length) {
      rotationIndexRef.current = 0;
      setRotationIndex(0);
      setRotationSnap(true);
    }
  };

  const updateSelectionStart = () => {
    setSelectionStart(textareaRef.current?.selectionStart ?? value.length);
  };

  // 右侧弹层里选定「模型 + 推理等级」：mode 由该模型自己的可选项给出，必然受支持。
  const pickComposerModel = (
    provider: ProviderConfig,
    nextModel: string,
    mode: ReasoningMode | undefined
  ) => {
    console.info("[composer] 选定模型与推理等级", {
      providerId: provider.id,
      model: nextModel,
      reasoningMode: mode
    });
    setProviderId(provider.id);
    setModel(nextModel === provider.model ? undefined : nextModel);
    setReasoningMode(mode);
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
    // 退格删除：光标贴着某个灰底片段（斜杠命令 / @ 文件引用）末尾时，整块一次删掉。
    if (event.key === "Backspace" && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const target = event.currentTarget;
      if (target.selectionStart === target.selectionEnd) {
        const caret = target.selectionStart;
        const block = highlightRanges.find((range) => range.end === caret);
        if (block) {
          event.preventDefault();
          const next = value.slice(0, block.start) + value.slice(block.end);
          setInput(next);
          window.requestAnimationFrame(() => {
            const textarea = textareaRef.current;
            if (!textarea) {
              return;
            }
            textarea.setSelectionRange(block.start, block.start);
            setSelectionStart(block.start);
          });
          return;
        }
      }
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
	      (!currentComposerRunning || awaitingAskUser)
	    ) {
      event.preventDefault();
      if (canSend) {
        void submit();
      }
      return;
    }
	    if (
	      (event.metaKey || event.ctrlKey) &&
	      event.key === "Enter" &&
	      (!currentComposerRunning || awaitingAskUser)
	    ) {
	      void submit();
	    }
  };

  const submitBlankProject = async () => {
    const name = blankName.trim();
    if (!name || creatingBlank) {
      return;
    }
    setCreatingBlank(true);
    try {
      await createBlankProject(name);
      setBlankDialogOpen(false);
      setBlankName("");
    } finally {
      setCreatingBlank(false);
    }
  };

  return (
    <div
      data-testid="composer-shell"
      className="relative w-full rounded-xl border border-border bg-card transition-colors focus-within:border-form-focus"
    >
      {attachments.length > 0 ? (
        <div className="flex flex-wrap gap-2.5 px-4 pt-3.5">
          {attachments.map((attachment) => (
            <ComposerAttachmentCard
              key={attachment.path}
              attachment={attachment}
              onOpen={() => openFilePreview(attachment.path)}
              onRemove={() => removeAttachment(attachment.path)}
            />
          ))}
        </div>
      ) : null}

      <Popover open={Boolean(activeSuggestionMenu)}>
        <PopoverAnchor asChild>
          <div ref={suggestionAnchorRef} className="relative">
            {highlightRanges.length > 0 ? (
              <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
                <div
                  ref={highlightInnerRef}
                  className="whitespace-pre-wrap break-words px-4 pb-3 pt-3.5 text-body text-transparent"
                >
                  {renderHighlightNodes(value, highlightRanges)}
                </div>
              </div>
            ) : null}
            <Textarea
              ref={textareaRef}
              rows={1}
              aria-label={t("composer.messageLabel")}
              placeholder={
	                awaitingAskUser
	                  ? t("composer.askUserWaiting")
	                  : currentComposerRunning
	                    ? t("composer.runningPlaceholder")
                    : rotatingActive
                      ? ""
                      : t("composer.placeholder")
              }
              value={value}
              onChange={(event) => {
                setInput(event.target.value);
                setSelectionStart(event.target.selectionStart);
              }}
              onClick={updateSelectionStart}
              onKeyUp={updateSelectionStart}
              onSelect={updateSelectionStart}
              onKeyDown={handleTextareaKeyDown}
              onScroll={(event) => {
                if (highlightInnerRef.current) {
                  highlightInnerRef.current.style.transform = `translateY(-${event.currentTarget.scrollTop}px)`;
                }
              }}
              className="relative z-[1] max-h-[220px] min-h-[68px] resize-none overflow-y-auto rounded-none border-0 bg-transparent px-4 pb-3 pt-3.5 text-body focus-visible:border-transparent focus-visible:ring-0"
            />

            {rotatingActive ? (
              <div
                aria-hidden
                className="pointer-events-none absolute left-4 right-4 top-3.5 z-[2] overflow-hidden"
                style={{ height: ROTATION_LINE_HEIGHT_PX }}
              >
                <div
                  className={cn(
                    "flex flex-col",
                    rotationSnap ? "" : "transition-transform duration-500 ease-in-out"
                  )}
                  style={{ transform: `translateY(-${rotationIndex * ROTATION_LINE_HEIGHT_PX}px)` }}
                  onTransitionEnd={handleRotationTransitionEnd}
                >
                  {[...placeholderRotation, placeholderRotation[0]].map((line, index) => (
                    <span
                      key={index}
                      className="flex items-center truncate text-body text-muted-slate"
                      style={{ height: ROTATION_LINE_HEIGHT_PX }}
                    >
                      {line}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </PopoverAnchor>
        <PopoverContent
          side="top"
          align="start"
          sideOffset={8}
          aria-label={
            activeSuggestionMenu === "slash"
              ? t("composer.slashMenuLabel")
              : t("composer.fileMenuLabel")
          }
          className="max-h-[260px] overflow-y-auto p-0"
          style={suggestionMenuWidth ? { width: suggestionMenuWidth } : undefined}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          {activeSuggestionMenu === "slash" ? (
            <div className="py-1">
              {filteredSlashCommands.map((command, index) => (
                <button
                  key={command.id}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left transition-colors",
                    index === highlightedCommand
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/60"
                  )}
                  onMouseEnter={() => setHighlightedCommand(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    insertSlashCommand(command);
                  }}
                  onClick={() => insertSlashCommand(command)}
                >
                  <span className="flex size-6 flex-none items-center justify-center rounded-sm bg-canvas-soft-2 text-muted-foreground">
                    <Sparkles className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-body-sm font-medium leading-tight text-foreground">
                      {command.name}
                    </span>
                    <span className="mt-0.5 block truncate text-micro text-muted-foreground">
                      {command.description || t("composer.slashNoDescription")}
                    </span>
                  </span>
                  <span className="flex flex-none items-center gap-1.5">
                    <span className="rounded-sm bg-canvas-soft-2 px-1.5 py-0.5 text-micro font-medium text-muted-foreground">
                      {t(`composer.slashSource.${command.source}`)}
                    </span>
                    <StampBadge
                      text={t("composer.kindSkill")}
                      fullLabel={t("composer.kindSkillFull")}
                      tone="indigo"
                    />
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="py-1">
              {fileSuggestions.map((path, index) => (
                <button
                  key={path}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left transition-colors",
                    index === highlightedCommand
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/60"
                  )}
                  onMouseEnter={() => setHighlightedCommand(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    insertFileReference(path);
                  }}
                  onClick={() => insertFileReference(path)}
                >
                  <span className="flex size-6 flex-none items-center justify-center rounded-sm bg-canvas-soft-2 text-muted-foreground">
                    <FileText className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-body-sm">{path}</span>
                  <span className="flex-none rounded-sm bg-canvas-soft-2 px-1.5 py-0.5 text-micro font-medium text-muted-foreground">
                    {t("composer.atFileTag")}
                  </span>
                </button>
              ))}
            </div>
          )}
        </PopoverContent>
      </Popover>

      <div className="flex min-w-0 items-center gap-1 px-2.5 pb-2.5 pt-0 [&_svg]:stroke-[1.75]">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title={t("composer.addContext")}
              className="size-8 flex-none rounded-sm text-foreground hover:bg-canvas-soft-2"
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
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => openSkills(true)}>
              <Sparkles className="size-4 text-muted-foreground" />
              {t("skills.addCustom")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openSkills(false)}>
              <Sparkles className="size-4 text-muted-foreground" />
              {t("skills.manage")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu
          onOpenChange={(open) => {
            if (!open) {
              setProjectQuery("");
            }
          }}
        >
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 min-w-0 max-w-[150px] shrink gap-1.5 rounded-sm px-2.5 text-micro font-normal text-foreground hover:bg-canvas-soft-2"
            >
              <Folder className="size-4" />
              <span className="min-w-0 flex-1 truncate">
                {activeProject?.name ?? t("composer.conversationMode")}
              </span>
              <ChevronDown className="size-3.5 flex-none" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="min-w-[260px]"
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            {/* 搜索框：阻断键盘冒泡，避免触发菜单自带的首字母定位 */}
            <div className="px-1 pb-1.5" onKeyDown={(event) => event.stopPropagation()}>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  autoFocus
                  value={projectQuery}
                  onChange={(event) => setProjectQuery(event.target.value)}
                  placeholder={t("composer.searchProjects")}
                  className="h-8 pl-8"
                />
              </div>
            </div>
            <div className="max-h-[280px] overflow-y-auto">
              {filteredProjects.length > 0 ? (
                filteredProjects.map((project) => (
                  <DropdownMenuItem
                    key={project.id}
                    onSelect={() => setActiveProjectId(project.id)}
                  >
                    <Folder className="size-4 text-muted-foreground" />
                    <span className="flex-1 truncate">{project.name}</span>
                    <Check
                      className={cn(
                        "size-4",
                        project.id === activeProject?.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                  </DropdownMenuItem>
                ))
              ) : (
                <div className="px-2.5 py-2 text-body-sm text-muted-foreground">
                  {t("composer.noMatchingProjects")}
                </div>
              )}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Plus className="size-4 text-muted-foreground" />
                {t("composer.addProject")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem
                  onSelect={() => {
                    setBlankName("");
                    setBlankDialogOpen(true);
                  }}
                >
                  <Plus className="size-4 text-muted-foreground" />
                  {t("composer.createBlankProject")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void openFolder()}>
                  <FolderOpen className="size-4 text-muted-foreground" />
                  {t("composer.useExistingFolder")}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onSelect={() => setActiveProjectId(undefined)}>
              <FolderDashed className="size-4 text-muted-foreground" />
              <span className="flex-1 truncate">{t("composer.noProject")}</span>
              <Check className={cn("size-4", activeProject ? "opacity-0" : "opacity-100")} />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {planMode ? (
          <button
            type="button"
            title={t("composer.planModeOff")}
            onClick={() => setPlanMode(false)}
            className="flex h-8 flex-none items-center gap-1.5 rounded-sm px-2.5 text-micro font-normal text-link transition-colors hover:bg-link/10"
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
              className={cn(
                "h-8 flex-none gap-1.5 rounded-sm px-2.5 text-micro font-normal transition-colors",
                accessTone.trigger,
                accessTone.hover
              )}
            >
              {accessMode === "full_access" ? (
                <ShieldCheck className="size-4" />
              ) : accessMode === "smart_approval" ? (
                <Sparkles className="size-4" />
              ) : (
                <LockKeyhole className="size-4" />
              )}
              {t(
                accessMode === "full_access"
                  ? "permission.fullAccess"
                  : accessMode === "smart_approval"
                    ? "permission.smartApproval"
                    : "permission.approval"
              )}
              <ChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[280px]">
            <DropdownMenuItem
              className="items-start gap-2.5 py-2.5"
              onSelect={() => setAccessMode("approval")}
            >
              <LockKeyhole
                className={cn(
                  "mt-0.5 size-4 flex-none",
                  ACCESS_MODE_TONES.approval.menuIcon
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{t("permission.approval")}</span>
                <span className="mt-0.5 block text-caption leading-snug text-muted-foreground">
                  {t("settings.general.approvalDesc")}
                </span>
              </span>
              <Check
                className={cn(
                  "mt-0.5 size-4 flex-none",
                  ACCESS_MODE_TONES.approval.check,
                  accessMode === "approval" ? "opacity-100" : "opacity-0"
                )}
              />
            </DropdownMenuItem>
            <DropdownMenuItem
              className="items-start gap-2.5 py-2.5"
              onSelect={() => setAccessMode("smart_approval")}
            >
              <Sparkles
                className={cn(
                  "mt-0.5 size-4 flex-none",
                  ACCESS_MODE_TONES.smart_approval.menuIcon
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{t("permission.smartApproval")}</span>
                <span className="mt-0.5 block text-caption leading-snug text-muted-foreground">
                  {t("settings.general.smartDesc")}
                </span>
              </span>
              <Check
                className={cn(
                  "mt-0.5 size-4 flex-none",
                  ACCESS_MODE_TONES.smart_approval.check,
                  accessMode === "smart_approval" ? "opacity-100" : "opacity-0"
                )}
              />
            </DropdownMenuItem>
            <DropdownMenuItem
              className="items-start gap-2.5 py-2.5"
              onSelect={() => setAccessMode("full_access")}
            >
              <ShieldCheck
                className={cn(
                  "mt-0.5 size-4 flex-none",
                  ACCESS_MODE_TONES.full_access.menuIcon
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{t("permission.fullAccess")}</span>
                <span className="mt-0.5 block text-caption leading-snug text-muted-foreground">
                  {t("settings.general.fullDesc")}
                </span>
              </span>
              <Check
                className={cn(
                  "mt-0.5 size-4 flex-none",
                  ACCESS_MODE_TONES.full_access.check,
                  accessMode === "full_access" ? "opacity-100" : "opacity-0"
                )}
              />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="min-w-0 flex-1" />

        {activeSessionId && selectedProvider ? (
          <ContextUsageIndicator
            usage={contextUsage}
            loading={contextUsageLoading}
            error={contextUsageError}
            modelLabel={
              selectedModelOption
                ? modelOptionLabel(selectedModelOption)
                : selectedModel ?? selectedProvider.model
            }
          />
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t("composer.selectModel")}
              disabled={configuredProviders.length === 0}
              className="h-8 min-w-0 max-w-[220px] shrink gap-1.5 rounded-sm px-2.5 text-micro font-normal text-foreground hover:bg-canvas-soft-2"
            >
              <span className="min-w-0 truncate">
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
          <DropdownMenuContent align="end" className="min-w-[200px]">
            {/* 左侧弹层：平铺模型；hover 某个模型后右侧再弹出它的推理等级等配置 */}
            {configuredProviders.flatMap((provider) => {
              const options = withCurrentComposerModel(
                provider,
                modelOptionsByProvider[provider.id],
                provider.id === selectedProvider?.id ? selectedModel : undefined
              );
              return options.map((option) => {
                const isSelected =
                  provider.id === selectedProvider?.id && option.id === selectedModel;
                const activeReasoning = isSelected ? selectedReasoningMode : undefined;
                return (
                  <DropdownMenuSub key={`${provider.id}::${option.id}`}>
                    <DropdownMenuSubTrigger hideChevron>
                      <span className="flex-1 truncate">{modelOptionLabel(option)}</span>
                      <Check
                        className={cn(
                          "size-4 flex-none",
                          isSelected ? "opacity-100" : "opacity-0"
                        )}
                      />
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="min-w-[132px]">
                      <DropdownMenuLabel>
                        {t("settings.providers.reasoning")}
                      </DropdownMenuLabel>
                      {option.reasoningModes.length > 0 ? (
                        <>
                          <DropdownMenuItem
                            onSelect={() => pickComposerModel(provider, option.id, undefined)}
                          >
                            <span className="flex-1">
                              {t("settings.providers.reasoningDefault")}
                            </span>
                            <Check
                              className={cn(
                                "size-4 flex-none",
                                isSelected && activeReasoning === undefined
                                  ? "opacity-100"
                                  : "opacity-0"
                              )}
                            />
                          </DropdownMenuItem>
                          {option.reasoningModes.map((mode) => (
                            <DropdownMenuItem
                              key={mode}
                              onSelect={() => pickComposerModel(provider, option.id, mode)}
                            >
                              <span className="flex-1">{reasoningModeLabel(t, mode)}</span>
                              <Check
                                className={cn(
                                  "size-4 flex-none",
                                  isSelected && activeReasoning === mode
                                    ? "opacity-100"
                                    : "opacity-0"
                                )}
                              />
                            </DropdownMenuItem>
                          ))}
                        </>
                      ) : (
                        <DropdownMenuItem
                          onSelect={() => pickComposerModel(provider, option.id, undefined)}
                        >
                          <span className="flex-1">
                            {option.reasoningAlwaysOn
                              ? t("settings.providers.reasoningAlwaysOn")
                              : t("settings.providers.reasoningDefault")}
                          </span>
                          <Check
                            className={cn(
                              "size-4 flex-none",
                              isSelected ? "opacity-100" : "opacity-0"
                            )}
                          />
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                );
              });
            })}
          </DropdownMenuContent>
        </DropdownMenu>

	        {currentComposerRunning ? (
          <Button
            size="icon"
            className="size-8 flex-none rounded-sm bg-primary text-primary-foreground hover:bg-primary/85"
            title={t("composer.stop")}
            onClick={() => void abortRun()}
          >
            <Square className="size-3.5 fill-current" />
          </Button>
        ) : (
          <Button
            size="icon"
            className="size-8 flex-none rounded-sm bg-primary text-primary-foreground transition-opacity hover:bg-primary/85 disabled:bg-muted disabled:text-muted-foreground"
            title={t("composer.send")}
            disabled={!canSend}
            onClick={() => void submit()}
          >
            <ArrowUp className="size-[18px]" />
          </Button>
        )}
      </div>

      <Dialog
        open={blankDialogOpen}
        onOpenChange={(open) => {
          if (creatingBlank) {
            return;
          }
          setBlankDialogOpen(open);
          if (!open) {
            setBlankName("");
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("composer.blankProjectTitle")}</DialogTitle>
            <DialogDescription>{t("composer.blankProjectHint")}</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={blankName}
            onChange={(event) => setBlankName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submitBlankProject();
              }
            }}
            placeholder={t("composer.blankProjectNamePlaceholder")}
          />
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setBlankDialogOpen(false)}
              disabled={creatingBlank}
            >
              {t("composer.cancel")}
            </Button>
            <Button
              onClick={() => void submitBlankProject()}
              disabled={!blankName.trim() || creatingBlank}
            >
              {t("composer.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ComposerAttachmentCard(props: {
  attachment: { path: string; name: string; size: number; kind?: string; text?: string };
  onOpen: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [fileUrl, setFileUrl] = useState<string | undefined>();
  const [imageFailed, setImageFailed] = useState(false);
  const [textPreview, setTextPreview] = useState<string | undefined>();
  const isImage = props.attachment.kind === "image";
  const canShowTextPreview = isAttachmentTextPreviewKind(props.attachment.kind);

  useEffect(() => {
    let disposed = false;
    let objectUrl: string | undefined;
    setFileUrl(undefined);
    setImageFailed(false);
    if (!isImage) {
      return () => {
        disposed = true;
      };
    }
    const bridge = window.chengxiaobang;
    if (!bridge?.readFilePreviewBuffer || typeof URL.createObjectURL !== "function") {
      console.warn("[composer] 图片附件卡片二进制预览能力不可用", {
        path: props.attachment.path
      });
      return () => {
        disposed = true;
      };
    }
    void bridge.readFilePreviewBuffer(props.attachment.path).then((result) => {
      if (disposed) {
        return;
      }
      if (result.ok) {
        objectUrl = URL.createObjectURL(
          new Blob([result.data], { type: imageMimeTypeForPath(props.attachment.path) })
        );
        setFileUrl(objectUrl);
        return;
      }
      console.warn("[composer] 图片附件卡片二进制预览读取失败", {
        path: props.attachment.path,
        error: result.error
      });
    });
    return () => {
      disposed = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [isImage, props.attachment.path]);

  useEffect(() => {
    let disposed = false;
    setTextPreview(undefined);
    if (!canShowTextPreview) {
      return () => {
        disposed = true;
      };
    }

    const cachedText = normalizeAttachmentPreviewText(props.attachment.text);
    if (cachedText) {
      setTextPreview(cachedText);
      return () => {
        disposed = true;
      };
    }

    const bridge = window.chengxiaobang;
    if (!bridge?.readFilePreviewText) {
      console.warn("[composer] 附件卡片文本预览能力不可用", {
        path: props.attachment.path,
        kind: props.attachment.kind
      });
      return () => {
        disposed = true;
      };
    }

    // 卡片只读取很小一段内容，避免输入框预览影响正式附件准备链路。
    void bridge
      .readFilePreviewText(props.attachment.path, {
        maxBytes: ATTACHMENT_CARD_TEXT_PREVIEW_BYTES
      })
      .then((result) => {
        if (disposed) {
          return;
        }
        if (result.ok) {
          setTextPreview(normalizeAttachmentPreviewText(result.text));
          return;
        }
        console.warn("[composer] 附件卡片文本预览读取失败", {
          path: props.attachment.path,
          kind: props.attachment.kind,
          error: result.error
        });
      });

    return () => {
      disposed = true;
    };
  }, [canShowTextPreview, props.attachment.kind, props.attachment.path, props.attachment.text]);

  const Icon = attachmentIconForKind(props.attachment.kind);
  const imageReady = isImage && fileUrl && !imageFailed;
  const showName = !isImage;

  return (
    <div
      className="group relative h-[108px] w-[88px] flex-none"
      title={`${props.attachment.path} · ${formatSize(props.attachment.size)}`}
    >
      <button
        type="button"
        onClick={props.onOpen}
        className="block h-full w-full min-w-0 text-left"
        title={t("chat.openAttachment", { name: props.attachment.name })}
        aria-label={t("chat.openAttachment", { name: props.attachment.name })}
      >
        <span
          className={cn(
            "relative flex w-full items-center justify-center overflow-hidden rounded-md border border-border bg-canvas-soft-2 text-muted-foreground shadow-hairline transition-colors group-hover:border-hairline-strong group-hover:bg-canvas-soft",
            showName ? "h-[88px]" : "h-full"
          )}
        >
          {imageReady ? (
            <img
              src={fileUrl}
              alt={t("chat.attachmentImageAlt", { name: props.attachment.name })}
              className="h-full w-full object-cover"
              draggable={false}
              onError={() => {
                console.warn("[composer] 图片附件卡片预览加载失败", {
                  path: props.attachment.path
                });
                setImageFailed(true);
              }}
            />
          ) : textPreview ? (
            <span className="h-full w-full overflow-hidden whitespace-pre-wrap break-words px-1.5 py-1.5 font-mono text-caption leading-4 text-body">
              {textPreview}
            </span>
          ) : (
            <Icon className="size-6" />
          )}
        </span>
        {showName ? (
          <span className="mt-1 block h-4 truncate text-caption leading-4 text-body">
            {props.attachment.name}
          </span>
        ) : null}
      </button>
      <button
        type="button"
        aria-label={t("composer.removeAttachment", { name: props.attachment.name })}
        onClick={props.onRemove}
        className="absolute right-1.5 top-1.5 z-10 flex size-[18px] items-center justify-center rounded-full bg-primary/95 text-primary-foreground shadow-subtle transition-colors hover:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
      >
        <X className="size-2.5" />
      </button>
    </div>
  );
}

function isAttachmentTextPreviewKind(kind: string | undefined): boolean {
  return kind === "text" || kind === "code" || kind === "markdown" || kind === "json";
}

function normalizeAttachmentPreviewText(text: string | undefined): string | undefined {
  const normalized = text?.replace(/\r\n?/gu, "\n").trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.length > 260 ? `${normalized.slice(0, 260)}...` : normalized;
}

function imageMimeTypeForPath(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    case "bmp":
      return "image/bmp";
    case "svg":
      return "image/svg+xml";
    case "png":
    default:
      return "image/png";
  }
}

function attachmentIconForKind(kind: string | undefined): Icon {
  switch (kind) {
    case "image":
      return FileImage;
    case "pdf":
      return FilePdf;
    case "code":
    case "json":
    case "html":
    case "markdown":
      return FileCode;
    case "docx":
      return FileDoc;
    case "presentation":
      return FilePpt;
    case "spreadsheet":
      return FileSpreadsheet;
    case "audio":
      return FileAudio;
    case "video":
      return FileVideo;
    case "text":
      return FileText;
    default:
      return FileAttachment;
  }
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

// 计算输入框中需要打灰底标记的特殊片段：开头的斜杠命令、以及 @ 文件引用。
// 返回按位置升序、互不重叠的区间，供 highlight overlay 渲染。
function getComposerHighlightRanges(
  value: string,
  commands: SlashCommand[],
  allowAtTokens: boolean
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  if (value.startsWith("/")) {
    const firstLine = value.split("\n", 1)[0] ?? "";
    // 取最长的、与输入开头完整匹配的已知命令名（兼容 "/git status" 这类带空格的命令）。
    let matched = "";
    for (const command of commands) {
      const name = command.name;
      const isFullMatch =
        firstLine === name || (firstLine.startsWith(name) && firstLine[name.length] === " ");
      if (isFullMatch && name.length > matched.length) {
        matched = name;
      }
    }
    if (matched) {
      ranges.push({ start: 0, end: matched.length });
    }
  }
  if (allowAtTokens) {
    const atPattern = /(^|\s)(@[^\s@]+)/g;
    let match: RegExpExecArray | null;
    while ((match = atPattern.exec(value)) !== null) {
      const start = match.index + match[1].length;
      ranges.push({ start, end: start + match[2].length });
    }
  }
  return ranges;
}

// 把输入文本按高亮区间切片渲染：高亮片段套灰底 span，其余为透明文本（仅占位对齐，真正文字由 textarea 显示）。
function renderHighlightNodes(
  value: string,
  ranges: Array<{ start: number; end: number }>
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    if (range.start > cursor) {
      nodes.push(<span key={`plain-${index}`}>{value.slice(cursor, range.start)}</span>);
    }
    nodes.push(
      <span
        key={`mark-${index}`}
        className="box-decoration-clone -mx-[4px] rounded-md bg-canvas-soft-2 px-[4px] py-[2px]"
      >
        {value.slice(range.start, range.end)}
      </span>
    );
    cursor = range.end;
  });
  if (cursor < value.length) {
    nodes.push(<span key="tail">{value.slice(cursor)}</span>);
  }
  return nodes;
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
  const afterSlash = beforeCursor.slice(1);
  // 命令一旦带空格即视为已选定（菜单只列技能，技能名无空格），收起补全框，避免残留只剩一项的小框。
  if (/\s/.test(afterSlash)) {
    return undefined;
  }
  return afterSlash.toLowerCase();
}

function filterSlashCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  const skillCommands = commands.filter((command) => command.kind === "skill");
  const compactQuery = query.trim();
  if (!compactQuery) {
    return skillCommands;
  }
  return skillCommands.filter((command) =>
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

function ContextUsageIndicator(props: {
  usage?: SessionContextUsage;
  loading: boolean;
  error?: string;
  modelLabel: string;
}) {
  const { t } = useTranslation();
  const percent = props.usage?.usedRatio;
  const status = props.usage?.status ?? "unknown";
  const ringColor = contextRingColor(status);
  const degrees = Math.min(360, Math.max(0, (percent ?? 0) * 360));
  const sessionCostValue = t("composer.context.estimatedCostValue", {
    value: formatCny(props.usage?.sessionCostCny)
  });
  const [open, setOpen] = useState(false);
  const lockedOpenRef = useRef(false);
  const closeTimerRef = useRef<number | undefined>(undefined);

  const clearCloseTimer = () => {
    if (closeTimerRef.current !== undefined) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }
  };
  const openTransient = () => {
    clearCloseTimer();
    setOpen(true);
  };
  const scheduleTransientClose = () => {
    clearCloseTimer();
    if (lockedOpenRef.current) {
      return;
    }
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      closeTimerRef.current = undefined;
    }, 120);
  };

  useEffect(() => () => clearCloseTimer(), []);

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          lockedOpenRef.current = false;
        }
      }}
    >
      <PopoverAnchor asChild>
        <button
          type="button"
          aria-label={t("composer.context.ariaLabel")}
          aria-busy={props.loading}
          aria-expanded={open}
          aria-haspopup="dialog"
          onPointerEnter={openTransient}
          onPointerLeave={scheduleTransientClose}
          onFocus={openTransient}
          onBlur={scheduleTransientClose}
          onClick={() => {
            clearCloseTimer();
            lockedOpenRef.current = !lockedOpenRef.current;
            setOpen(lockedOpenRef.current);
          }}
          className={cn(
            "flex h-8 w-6 flex-none items-center justify-center rounded-sm text-muted-foreground outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            (status === "over_threshold" || status === "near_threshold") && "text-warning-deep"
          )}
        >
          {props.loading && !props.usage ? (
            <span className="size-5 rounded-full border border-muted-foreground/25 border-t-foreground animate-spin" />
          ) : (
            <span
              aria-hidden
              className="relative size-5 rounded-full"
              style={{
                background: `conic-gradient(${ringColor} ${degrees}deg, rgb(var(--border)) 0deg)`
              }}
            >
              <span className="absolute inset-[4px] rounded-full bg-card" />
            </span>
          )}
        </button>
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="end"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onPointerEnter={openTransient}
        onPointerLeave={scheduleTransientClose}
        className="w-[300px] px-3 py-2.5 text-left text-micro"
      >
        <div className="space-y-2">
          <div>
            <div className="font-medium">{t("composer.context.title")}</div>
            <div className="mt-0.5 truncate text-muted-foreground">{props.modelLabel}</div>
          </div>
          {props.error ? (
            <div className="rounded-xs bg-warning-soft px-2 py-1 text-warning-deep">
              {t("composer.context.error", { error: props.error })}
            </div>
          ) : null}
          {props.usage ? (
            <div className="space-y-1">
              <ContextUsageRow
                label={t("composer.context.usedRatio")}
                value={formatPercent(props.usage.usedRatio)}
              />
              <ContextUsageRow
                label={t("composer.context.used")}
                value={`${formatTokenCount(props.usage.estimatedTokens)} / ${formatTokenCount(
                  props.usage.contextWindowTokens
                )}`}
              />
              <ContextUsageRow
                label={t("composer.context.threshold")}
                value={`${formatTokenCount(props.usage.autoCompactThresholdTokens)} (${formatPercent(
                  props.usage.autoCompactThresholdRatio
                )})`}
              />
              <ContextUsageRow
                label={t("composer.context.sessionCost")}
                value={sessionCostValue}
              />
              <ContextUsageRow
                label={t("composer.context.remaining")}
                value={formatTokenCount(props.usage.remainingTokens)}
              />
              <ContextUsageRow
                label={t("composer.context.breakdown")}
                value={t("composer.context.breakdownValue", {
                  system: formatTokenCount(props.usage.systemPromptTokens),
                  messages: formatTokenCount(props.usage.messageTokens),
                  tools: formatTokenCount(props.usage.toolTokens)
                })}
              />
              <ContextUsageRow
                label={t("composer.context.statusLabel")}
                value={t(`composer.context.status.${props.usage.status}`)}
              />
            </div>
          ) : (
            <div className="text-muted-foreground">
              {props.loading
                ? t("composer.context.loading")
                : t("composer.context.unavailable")}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ContextUsageRow(props: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-muted-foreground">{props.label}</span>
      <span className="text-right font-mono text-foreground">{props.value}</span>
    </div>
  );
}

function contextRingColor(status: SessionContextUsage["status"]): string {
  if (status === "over_threshold" || status === "near_threshold") {
    return "rgb(var(--warning))";
  }
  if (status === "unknown") {
    return "rgb(var(--muted-foreground))";
  }
  return "rgb(var(--link))";
}

function formatPercent(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return `${Math.round(value * 100)}%`;
}

function formatTokenCount(tokens: number | undefined): string {
  if (tokens === undefined) {
    return "—";
  }
  if (tokens >= 1_000_000) {
    return `${trimFixed(tokens / 1_000_000)}M`;
  }
  if (tokens >= 1000) {
    return `${trimFixed(tokens / 1000)}K`;
  }
  return String(tokens);
}

function formatCny(value: number | undefined): string {
  if (value === undefined) {
    return "—";
  }
  return `¥${value.toFixed(2)}`;
}

function trimFixed(value: number): string {
  return value >= 10 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, "");
}
