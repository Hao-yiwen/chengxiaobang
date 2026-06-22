import {
  ArrowUpIcon,
  CheckMediumIcon,
  ChecklistPlanIcon,
  ChevronIcon,
  CircleOutlineIcon,
  DocumentIcon,
  FolderIcon,
  FolderOpenOutlineIcon,
  HandPointerIcon,
  MicrophoneOffIcon,
  MicrophoneOutlineIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  ShieldAlertIcon,
  ShieldTerminalIcon,
  SkillIcon,
  StopSquareFilledIcon
} from "@/assets/file-type-icons";
import type { KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import {
  resolveProviderConfigModelOption,
  type ProviderConfig,
  type ProviderModelOption,
  type ReasoningMode,
  type SessionContextUsage,
  type SlashCommand,
} from "@chengxiaobang/shared";
import { ComposerAttachmentCard } from "@/components/composer/attachment-card";
import {
  ACCESS_MODE_TONES,
  EMPTY_QUEUED_RUNS,
  ROTATION_INTERVAL_MS,
  ROTATION_LINE_HEIGHT_PX,
  TEXTAREA_MAX_HEIGHT_PX
} from "@/components/composer/constants";
import { ContextUsageIndicator } from "@/components/composer/context-usage-indicator";
import {
  modelOptionLabel,
  withCurrentComposerModel
} from "@/components/composer/model-options";
import { QueuedRunStack } from "@/components/composer/queued-run-stack";
import {
  filterSlashCommands,
  getAtToken,
  getComposerHighlightRanges,
  getSlashQuery,
  renderHighlightNodes
} from "@/components/composer/text-utils";
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
import { useAccessModeSelection } from "@/hooks/use-access-mode-selection";
import { resolveFileTypeIcon } from "@/lib/code-language-icons";
import { cn } from "@/lib/utils";
import { getApiClient, selectActiveProject, useAppStore } from "@/store";

export { getAtToken } from "@/components/composer/text-utils";

type ComposerT = (key: string) => unknown;
type SlashCommandSectionTitleKey =
  | "composer.slashCommandGroupCommands"
  | "composer.slashCommandGroupSkills";

interface SlashCommandSection {
  id: "commands" | "skills";
  titleKey: SlashCommandSectionTitleKey;
  commands: SlashCommand[];
  startIndex: number;
}

const REASONING_MODE_LABEL_KEYS: Record<ReasoningMode, string> = {
  off: "settings.providers.reasoningModes.off",
  auto: "settings.providers.reasoningModes.auto",
  minimal: "settings.providers.reasoningModes.minimal",
  low: "settings.providers.reasoningModes.low",
  medium: "settings.providers.reasoningModes.medium",
  high: "settings.providers.reasoningModes.high",
  xhigh: "settings.providers.reasoningModes.xhigh"
};
const VOICE_INPUT_LANGUAGE = "zh-CN";
const VOICE_WAVEFORM_BAR_COUNT = 54;
const VOICE_WAVEFORM_BASE_LEVEL = 0.08;
const VOICE_WAVEFORM_MIN_HEIGHT = 2;
const VOICE_WAVEFORM_MAX_HEIGHT = 24;
type VoiceInputState =
  | "checking"
  | "idle"
  | "recording"
  | "transcribing"
  | "unavailable"
  | "error";

function createInitialVoiceLevels(): number[] {
  return Array.from({ length: VOICE_WAVEFORM_BAR_COUNT }, () => VOICE_WAVEFORM_BASE_LEVEL);
}

function formatVoiceElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function voiceWaveformLevel(
  level: number,
  index: number,
  elapsedMs: number,
  state: VoiceInputState
): number {
  const clamped = Math.max(0, Math.min(1, level));
  if (state !== "recording") {
    return clamped;
  }
  const ambient = 0.1 + Math.max(0, Math.sin(index * 0.85 + elapsedMs / 180)) * 0.12;
  return Math.max(clamped, ambient);
}

function VoiceWaveform({
  levels,
  elapsedMs,
  state,
  onStop,
  stopLabel,
  transcribingLabel
}: {
  levels: number[];
  elapsedMs: number;
  state: VoiceInputState;
  onStop: () => void;
  stopLabel: string;
  transcribingLabel: string;
}) {
  return (
    <div
      data-testid="voice-waveform"
      className="flex h-8 min-w-[180px] flex-1 items-center gap-2 overflow-hidden"
    >
      <div className="relative flex h-7 min-w-0 flex-1 items-center overflow-hidden">
        <div className="absolute left-0 right-0 top-1/2 border-t border-dashed border-muted-foreground/35" />
        <div className="relative z-[1] flex h-full w-full items-center justify-center gap-[2px]">
          {levels.map((level, index) => {
            const displayLevel = voiceWaveformLevel(level, index, elapsedMs, state);
            const height =
              VOICE_WAVEFORM_MIN_HEIGHT +
              Math.round(displayLevel * (VOICE_WAVEFORM_MAX_HEIGHT - VOICE_WAVEFORM_MIN_HEIGHT));
            return (
              <span
                key={index}
                data-testid="voice-waveform-bar"
                className={cn(
                  "block w-[3px] flex-none rounded-full bg-foreground transition-[height,opacity] duration-100",
                  state === "transcribing" && "opacity-45"
                )}
                style={{ height }}
              />
            );
          })}
        </div>
      </div>
      <span className="w-10 flex-none text-right text-body-sm tabular-nums text-muted-foreground">
        {formatVoiceElapsed(elapsedMs)}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={stopLabel}
        title={state === "transcribing" ? transcribingLabel : stopLabel}
        disabled={state === "transcribing"}
        onClick={onStop}
        className="size-8 flex-none rounded-full bg-canvas-soft-2 text-foreground hover:bg-surface-hover disabled:text-muted-foreground/50"
      >
        <StopSquareFilledIcon className="size-[15px]" />
      </Button>
    </div>
  );
}

function reasoningModeLabel(t: ComposerT, mode: ReasoningMode): string {
  return String(t(REASONING_MODE_LABEL_KEYS[mode]));
}

function reasoningModeSummary(
  t: ComposerT,
  option: ProviderModelOption,
  mode: ReasoningMode | undefined
): string {
  if (mode) {
    return reasoningModeLabel(t, mode);
  }
  if (option.reasoningAlwaysOn) {
    return String(t("settings.providers.reasoningAlwaysOn"));
  }
  return "";
}

function fileSuggestionName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  if (!trimmed) {
    return path;
  }
  return trimmed.split(/[\\/]/).pop() ?? trimmed;
}

function fileSuggestionPathLabel(path: string, fileName: string): string | undefined {
  const normalizedPath = path.replace(/^[.][\\/]+/, "").replace(/[\\/]+$/, "");
  if (!normalizedPath || normalizedPath === fileName) {
    return undefined;
  }
  return normalizedPath;
}

function slashCommandDisplayName(command: SlashCommand): string {
  if (command.kind !== "skill") {
    return command.name;
  }
  return command.name.replace(/^\/+/, "") || command.name;
}

export function Composer() {
  const { t } = useTranslation();
  const composerT = t as unknown as ComposerT;
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
    queuedRuns,
    queuePaused,
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
        queuedRuns: state.activeSessionId
          ? (state.queuedRunsBySession[state.activeSessionId] ?? EMPTY_QUEUED_RUNS)
          : EMPTY_QUEUED_RUNS,
        queuePaused: state.activeSessionId
          ? Boolean(state.pausedRunQueuesBySession[state.activeSessionId])
          : false,
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
  const setNotice = useAppStore((state) => state.setNotice);
  const selectComposerModel = useAppStore((state) => state.selectComposerModel);
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
  const openOnboarding = useAppStore((state) => state.openOnboarding);
  const removeQueuedRun = useAppStore((state) => state.removeQueuedRun);
  const editQueuedRunInComposer = useAppStore((state) => state.editQueuedRunInComposer);
  const clearQueuedRuns = useAppStore((state) => state.clearQueuedRuns);
  const resumeQueuedRuns = useAppStore((state) => state.resumeQueuedRuns);
  const sendQueuedRunAsSteering = useAppStore((state) => state.sendQueuedRunAsSteering);

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
  const [contextUsage, setContextUsage] = useState<SessionContextUsage>();
  const [contextUsageLoading, setContextUsageLoading] = useState(false);
  const [contextUsageError, setContextUsageError] = useState<string>();
  const [providerModelOptions, setProviderModelOptions] = useState<
    Record<string, ProviderModelOption[]>
  >({});
  const [voiceState, setVoiceState] = useState<VoiceInputState>("checking");
  const [voiceSessionId, setVoiceSessionId] = useState<string>();
  const voiceSessionIdRef = useRef<string | undefined>(undefined);
  const [voiceUnavailableReason, setVoiceUnavailableReason] = useState<string>();
  const [voiceLevels, setVoiceLevels] = useState(createInitialVoiceLevels);
  const [voiceElapsedMs, setVoiceElapsedMs] = useState(0);
  const voiceStartedAtRef = useRef<number | undefined>(undefined);
  const configuredProviders = providers.filter((provider) => provider.apiKeyRef);
  const configuredProviderOptionsKey = configuredProviders
    .map((provider) =>
      [
        provider.id,
        provider.apiKeyRef ?? "",
        provider.updatedAt,
        provider.model,
        provider.models?.join(",") ?? ""
      ].join(":")
    )
    .join("|");
  const selectedProvider = configuredProviders.find((provider) => provider.id === providerId);
  const selectedModel = selectedProvider ? model ?? selectedProvider.model : undefined;
  const selectedProviderModelOptions = selectedProvider
    ? withCurrentComposerModel(
        selectedProvider,
        providerModelOptions[selectedProvider.id],
        selectedModel
      )
    : [];
  const selectedModelOption = selectedModel
    ? selectedProviderModelOptions.find((option) => option.id === selectedModel) ??
      (selectedProvider
        ? resolveProviderConfigModelOption(selectedProvider, selectedModel)
        : undefined)
    : undefined;
  const selectedModelLabel =
    selectedModelOption
      ? modelOptionLabel(selectedModelOption)
      : selectedModel ?? t("composer.selectModel");
  const configuredReasoningMode = reasoningMode ?? selectedProvider?.reasoningMode;
  const selectedReasoningMode =
    selectedModelOption && configuredReasoningMode
      ? selectedModelOption.reasoningModes.includes(configuredReasoningMode)
        ? configuredReasoningMode
        : undefined
      : undefined;
  const hasReasoningSummary =
    selectedModelOption !== undefined &&
    (selectedReasoningMode !== undefined || selectedModelOption.reasoningAlwaysOn === true);
  const accessTone = ACCESS_MODE_TONES[accessMode];
  const selectAccessMode = useAccessModeSelection({
    accessMode,
    setAccessMode,
    source: "composer"
  });
  const currentComposerRunning =
    view !== "home" && isRunning && (Boolean(activeRunId) || Boolean(activeRunClientRequestId));
  const awaitingAskUser = currentComposerRunning && pendingTool?.name === "AskUserQuestion";
  const showProjectSelector = view === "home";
  const slashQuery = getSlashQuery(value, selectionStart);
  const filteredSlashCommands = useMemo(
    () => filterSlashCommands(slashCommands, slashQuery ?? ""),
    [slashCommands, slashQuery]
  );
  const slashCommandSections = useMemo(() => {
    const commandItems = filteredSlashCommands.filter((command) => command.kind !== "skill");
    const skillItems = filteredSlashCommands.filter((command) => command.kind === "skill");
    const groups: SlashCommandSection[] = [
      {
        id: "commands",
        titleKey: "composer.slashCommandGroupCommands",
        commands: commandItems,
        startIndex: 0
      },
      {
        id: "skills",
        titleKey: "composer.slashCommandGroupSkills",
        commands: skillItems,
        startIndex: commandItems.length
      }
    ];
    return {
      ordered: [...commandItems, ...skillItems],
      groups: groups.filter((group) => group.commands.length > 0)
    };
  }, [filteredSlashCommands]);
  const showSlashMenu = slashQuery !== undefined && slashCommandSections.ordered.length > 0;

  // 首页项目目录里的 @ 文件引用；按 Escape 会隐藏当前 @ token 的建议。
  const [dismissedAtToken, setDismissedAtToken] = useState<{ start: number; query: string }>();
  const [fileSuggestionsLoading, setFileSuggestionsLoading] = useState(false);
  const [searchedAtQuery, setSearchedAtQuery] = useState<string>();
  const fileSuggestions = useAppStore((state) => state.fileSuggestions);
  const loadFileSuggestions = useAppStore((state) => state.loadFileSuggestions);
  const allowAtFileSuggestions = view === "home" && activeProject !== undefined;
  const atToken = allowAtFileSuggestions ? getAtToken(value, selectionStart) : undefined;
  const currentAtDismissed =
    atToken !== undefined &&
    dismissedAtToken?.start === atToken.start &&
    dismissedAtToken.query === atToken.query;
  const showFileMenu =
    !showSlashMenu &&
    atToken !== undefined &&
    !currentAtDismissed &&
    (fileSuggestionsLoading || searchedAtQuery === atToken.query || fileSuggestions.length > 0);
  const activeSuggestionMenu = showSlashMenu ? "slash" : showFileMenu ? "file" : undefined;
  // 已插入的斜杠命令 / @ 文件引用渲染成 token，与普通输入区分。
  const highlightRanges = useMemo(
    () => getComposerHighlightRanges(value, slashCommands, allowAtFileSuggestions),
    [value, slashCommands, allowAtFileSuggestions]
  );
  // 未配置供应商时也允许触发提交，store 会打开首次配置弹窗。
  const canSend = value.trim().length > 0 || attachments.length > 0;
  const showVoiceMeter = voiceState === "recording" || voiceState === "transcribing";
  // 仅首页、输入框为空且非运行/等待回答时，用轮播文案替代静态占位。
  const rotatingActive =
    view === "home" &&
    !currentComposerRunning &&
    !awaitingAskUser &&
    value.length === 0 &&
    placeholderRotation.length > 1;
  const voiceButtonTitle =
    voiceState === "recording"
      ? t("composer.voiceStop")
      : voiceState === "transcribing"
        ? t("composer.voiceTranscribing")
        : voiceState === "unavailable"
          ? (voiceUnavailableReason ?? t("composer.voiceUnavailable"))
          : t("composer.voiceStart");
  const voiceButtonDisabled =
    voiceState === "checking" || voiceState === "transcribing" || voiceState === "unavailable";

  useEffect(() => {
    setHighlightedCommand(0);
  }, [slashQuery, slashCommandSections.ordered.length, atToken?.query, fileSuggestions.length]);

  useEffect(() => {
    let cancelled = false;
    const speechAvailability = window.chengxiaobang?.speechAvailability;
    if (!speechAvailability) {
      setVoiceState("unavailable");
      setVoiceUnavailableReason(String(t("composer.voiceUnavailable")));
      return;
    }
    setVoiceState("checking");
    void speechAvailability({ language: VOICE_INPUT_LANGUAGE })
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (result.available) {
          console.info("[composer] 系统语音输入可用", {
            platform: result.platform,
            language: result.language
          });
          setVoiceState("idle");
          setVoiceUnavailableReason(undefined);
          return;
        }
        console.info("[composer] 系统语音输入不可用", {
          platform: result.platform,
          language: result.language,
          reason: result.reason
        });
        setVoiceState("unavailable");
        setVoiceUnavailableReason(result.reason ?? String(t("composer.voiceUnavailable")));
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[composer] 系统语音输入可用性检查失败", { error: message });
        setVoiceState("unavailable");
        setVoiceUnavailableReason(message);
      });
    return () => {
      cancelled = true;
      void window.chengxiaobang?.speechCancel?.(
        voiceSessionIdRef.current ? { sessionId: voiceSessionIdRef.current } : undefined
      );
    };
  }, [t]);

  useEffect(() => {
    const unsubscribe = window.chengxiaobang?.onSpeechEvent?.((event) => {
      if (event.type !== "level" || event.sessionId !== voiceSessionIdRef.current) {
        return;
      }
      setVoiceElapsedMs(event.elapsedMs);
      setVoiceLevels((current) => [...current.slice(1), event.level]);
    });
    return () => {
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (voiceState !== "recording") {
      return;
    }
    const timer = window.setInterval(() => {
      if (voiceStartedAtRef.current === undefined) {
        return;
      }
      setVoiceElapsedMs(Date.now() - voiceStartedAtRef.current);
    }, 250);
    return () => window.clearInterval(timer);
  }, [voiceState]);

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
    const listProviderModelOptions = client?.listProviderModelOptions;
    if (!listProviderModelOptions || configuredProviders.length === 0) {
      setProviderModelOptions({});
      return;
    }

    let cancelled = false;
    const providerIds = configuredProviders.map((provider) => provider.id);
    const liveProviderIds = new Set(providerIds);
    setProviderModelOptions((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([providerId]) => liveProviderIds.has(providerId))
      )
    );

    void Promise.all(
      providerIds.map(async (providerId) => {
        try {
          const options = await listProviderModelOptions(providerId);
          return { providerId, options };
        } catch (error) {
          console.warn("[composer] 拉取供应商模型选项失败，使用本地模型目录回退", {
            providerId,
            error: error instanceof Error ? error.message : String(error)
          });
          return { providerId, options: undefined };
        }
      })
    ).then((results) => {
      if (cancelled) {
        return;
      }
      setProviderModelOptions((current) => {
        const next = Object.fromEntries(
          Object.entries(current).filter(([providerId]) => liveProviderIds.has(providerId))
        ) as Record<string, ProviderModelOption[]>;
        for (const result of results) {
          if (result.options) {
            next[result.providerId] = result.options;
            continue;
          }
          delete next[result.providerId];
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [configuredProviderOptionsKey]);

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
    selectedReasoningMode,
    selectedModel,
    selectedProvider?.id,
  ]);

  // 输入 @ token 时防抖拉取项目文件建议。
  useEffect(() => {
    if (atToken === undefined) {
      setFileSuggestionsLoading(false);
      setSearchedAtQuery(undefined);
      return;
    }
    const query = atToken.query;
    let cancelled = false;
    setFileSuggestionsLoading(true);
    setSearchedAtQuery(undefined);
    const timer = window.setTimeout(() => {
      void loadFileSuggestions(query).finally(() => {
        if (cancelled) {
          return;
        }
        setFileSuggestionsLoading(false);
        setSearchedAtQuery(query);
      });
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
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

  const setActiveVoiceSession = (sessionId: string | undefined) => {
    voiceSessionIdRef.current = sessionId;
    setVoiceSessionId(sessionId);
  };

  const resetVoiceMeter = () => {
    voiceStartedAtRef.current = undefined;
    setVoiceElapsedMs(0);
    setVoiceLevels(createInitialVoiceLevels());
  };

  const insertVoiceText = (rawText: string) => {
    const text = rawText.trim();
    if (!text) {
      const message = String(t("composer.voiceNoText"));
      console.info("[composer] 系统语音输入未识别到文字");
      setNotice(message);
      return false;
    }
    const cursor = Math.max(
      0,
      Math.min(textareaRef.current?.selectionStart ?? selectionStart, value.length)
    );
    const prefix = value.slice(0, cursor);
    const suffix = value.slice(cursor);
    const before = prefix.length > 0 && !/\s$/.test(prefix) ? " " : "";
    const after = suffix.length > 0 && !/^\s/.test(suffix) ? " " : "";
    const next = `${prefix}${before}${text}${after}${suffix}`;
    const caret = prefix.length + before.length + text.length + after.length;
    setInput(next);
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) {
        return;
      }
      textarea.focus();
      textarea.setSelectionRange(caret, caret);
      setSelectionStart(caret);
    });
    console.info("[composer] 系统语音输入已插入输入框", {
      textChars: text.length,
      previousChars: value.length,
      nextChars: next.length
    });
    return true;
  };

  const startVoiceInput = async () => {
    const speechStart = window.chengxiaobang?.speechStart;
    if (!speechStart) {
      const message = String(t("composer.voiceUnavailable"));
      setVoiceState("unavailable");
      setVoiceUnavailableReason(message);
      setNotice(message);
      return;
    }
    console.info("[composer] 开始系统语音输入", { language: VOICE_INPUT_LANGUAGE });
    setVoiceState("checking");
    setVoiceUnavailableReason(undefined);
    try {
      const result = await speechStart({ language: VOICE_INPUT_LANGUAGE });
      if (!result.ok) {
        console.warn("[composer] 系统语音输入启动失败", { error: result.error });
        setVoiceState(result.available === false ? "unavailable" : "error");
        setVoiceUnavailableReason(result.error);
        resetVoiceMeter();
        setNotice(result.error);
        return;
      }
      setActiveVoiceSession(result.sessionId);
      voiceStartedAtRef.current = Date.now();
      setVoiceElapsedMs(0);
      setVoiceLevels(createInitialVoiceLevels());
      setVoiceState("recording");
      console.info("[composer] 系统语音输入进入录音态", {
        sessionId: result.sessionId,
        language: VOICE_INPUT_LANGUAGE
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[composer] 系统语音输入启动异常", { error: message });
      setVoiceState("error");
      setVoiceUnavailableReason(message);
      resetVoiceMeter();
      setNotice(message);
    }
  };

  const stopVoiceInput = async () => {
    const speechStop = window.chengxiaobang?.speechStop;
    if (!speechStop || !voiceSessionId) {
      setVoiceState("idle");
      setActiveVoiceSession(undefined);
      resetVoiceMeter();
      return;
    }
    console.info("[composer] 停止系统语音输入", {
      sessionId: voiceSessionId,
      language: VOICE_INPUT_LANGUAGE
    });
    setVoiceState("transcribing");
    try {
      const result = await speechStop({ sessionId: voiceSessionId });
      setActiveVoiceSession(undefined);
      voiceStartedAtRef.current = undefined;
      if (!result.ok) {
        console.warn("[composer] 系统语音输入转写失败", {
          sessionId: voiceSessionId,
          error: result.error,
          textChars: result.text?.length ?? 0
        });
        setVoiceState("error");
        setVoiceUnavailableReason(result.error);
        resetVoiceMeter();
        setNotice(result.error);
        return;
      }
      const inserted = insertVoiceText(result.text);
      setVoiceState("idle");
      setVoiceLevels(createInitialVoiceLevels());
      setVoiceElapsedMs(0);
      console.info("[composer] 系统语音输入转写完成", {
        sessionId: result.sessionId,
        textChars: result.text.length,
        elapsedMs: result.elapsedMs,
        inserted
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[composer] 系统语音输入停止异常", {
        sessionId: voiceSessionId,
        error: message
      });
      setActiveVoiceSession(undefined);
      resetVoiceMeter();
      setVoiceState("error");
      setVoiceUnavailableReason(message);
      setNotice(message);
    }
  };

  const handleVoiceButtonClick = () => {
    if (voiceState === "recording") {
      void stopVoiceInput();
      return;
    }
    void startVoiceInput();
  };

  const pickComposerModel = (
    nextProvider: ProviderConfig,
    nextModel: string,
    mode: ReasoningMode | undefined
  ) => {
    console.info("[composer] 选定模型与推理等级", {
      providerId: nextProvider.id,
      model: nextModel,
      defaultModel: nextProvider.model,
      reasoningMode: mode
    });
    void selectComposerModel(nextProvider.id, nextModel, mode);
  };

  const openProviderSetupFromComposer = () => {
    console.info("[composer] 未配置供应商，打开模型配置引导", {
      configuredProviderCount: configuredProviders.length,
      targetOnboardingStep: "model"
    });
    openOnboarding("model");
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
    // 退格删除：光标贴着某个 token（斜杠命令 / @ 文件引用）末尾时，整块一次删掉。
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
      const menuLength =
        menu === "slash" ? slashCommandSections.ordered.length : fileSuggestions.length;
      if (menuLength === 0) {
        if (
          event.key === "ArrowDown" ||
          event.key === "ArrowUp" ||
          event.key === "Enter" ||
          event.key === "Tab"
        ) {
          event.preventDefault();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          if (atToken !== undefined) {
            setDismissedAtToken({ start: atToken.start, query: atToken.query });
          }
          return;
        }
      }
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
          insertSlashCommand(
            slashCommandSections.ordered[highlightedCommand] ?? slashCommandSections.ordered[0]
          );
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
          setDismissedAtToken({ start: atToken.start, query: atToken.query });
        }
        return;
      }
    }
    // Enter 提交，Shift+Enter 换行；中文输入法合成中不拦截。
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
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
      className="relative w-full rounded-lg border border-border bg-card transition-colors focus-within:border-hairline-strong/40 overflow-hidden"
    >
      {queuedRuns.length > 0 ? (
        <QueuedRunStack
          items={queuedRuns}
          paused={queuePaused}
          canSteer={currentComposerRunning && Boolean(activeRunId)}
          onSteer={(id) => void sendQueuedRunAsSteering(id)}
          onEdit={(id) => {
            editQueuedRunInComposer(id);
            window.requestAnimationFrame(() => textareaRef.current?.focus());
          }}
          onRemove={removeQueuedRun}
          onClear={() => clearQueuedRuns(activeSessionId)}
          onResume={() => void resumeQueuedRuns(activeSessionId)}
        />
      ) : null}

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
                  className="whitespace-pre-wrap break-words px-4 pb-3 pt-3.5 text-body-sm text-transparent"
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
                    ? t("composer.queuePlaceholder")
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
              className="relative z-[1] max-h-[220px] min-h-[68px] resize-none overflow-y-auto rounded-none border-0 bg-transparent px-4 pb-3 pt-3.5 text-body-sm font-normal placeholder:font-normal placeholder:text-muted-slate/75 focus-visible:border-transparent focus-visible:ring-0"
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
                      className="flex items-center truncate text-body-sm font-normal text-muted-slate/75"
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
          className={cn(
            "p-0",
            activeSuggestionMenu === "slash" && "scrollbar-hidden max-h-[260px] overflow-y-auto"
          )}
          style={suggestionMenuWidth ? { width: suggestionMenuWidth } : undefined}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          {activeSuggestionMenu === "slash" ? (
            <div className="py-1">
              {slashCommandSections.groups.map((group, groupIndex) => (
                <div
                  key={group.id}
                  className={cn(groupIndex > 0 && "mt-1 border-t border-border/70 pt-1")}
                >
                  <div className="px-3 pb-1 pt-1.5 text-caption font-medium text-muted-foreground">
                    {t(group.titleKey)}
                  </div>
                  {group.commands.map((command, index) => {
                    const commandIndex = group.startIndex + index;
                    const isSkillCommand = command.kind === "skill";
                    const CommandIcon = isSkillCommand ? SkillIcon : DocumentIcon;
                    const displayName = slashCommandDisplayName(command);
                    return (
                      <button
                        key={command.id}
                        type="button"
                        className={cn(
                          "flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors",
                          commandIndex === highlightedCommand
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-accent/60"
                        )}
                        onMouseEnter={() => setHighlightedCommand(commandIndex)}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          insertSlashCommand(command);
                        }}
                        onClick={() => insertSlashCommand(command)}
                      >
                        <span className="flex size-6 flex-none items-center justify-center rounded-sm bg-canvas-soft-2 text-muted-foreground">
                          <CommandIcon className="size-3.5" />
                        </span>
                        <span className="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden">
                          <span className="max-w-[60%] flex-none truncate font-mono text-caption font-medium text-foreground">
                            {displayName}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-micro text-muted-foreground">
                            {command.description || t("composer.slashNoDescription")}
                          </span>
                        </span>
                        <span className="flex-none rounded-sm bg-canvas-soft-2 px-1 py-0 text-[10px] font-medium leading-4 text-muted-foreground">
                          {t(`composer.slashSource.${command.source}`)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : (
            <div>
              <div className="border-b border-border px-3 py-2 text-caption font-medium text-foreground">
                {t("composer.fileMenuTitle")}
              </div>
              <div className="scrollbar-hidden max-h-[220px] overflow-y-auto py-1">
                {fileSuggestionsLoading ? (
                  <div className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-muted-foreground">
                    <span className="flex size-6 flex-none items-center justify-center">
                      <RefreshIcon className="size-3.5 animate-spin" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-caption">
                      {t("composer.fileSuggestionsLoading")}
                    </span>
                  </div>
                ) : fileSuggestions.length === 0 ? (
                  <div className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-muted-foreground">
                    <span className="flex size-6 flex-none items-center justify-center">
                      <SearchIcon className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-caption">
                      {t("composer.fileSuggestionsEmpty")}
                    </span>
                  </div>
                ) : (
                  fileSuggestions.map((path, index) => {
                    const FileIcon = resolveFileTypeIcon(path);
                    const fileName = fileSuggestionName(path);
                    const pathLabel = fileSuggestionPathLabel(path, fileName);
                    return (
                      <button
                        key={path}
                        type="button"
                        className={cn(
                          "flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left transition-colors",
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
                        <span className="flex size-5 flex-none items-center justify-center text-muted-foreground">
                          <FileIcon className="cxb-svg-icon size-3.5" />
                        </span>
                        <span
                          className="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden font-mono text-caption"
                          title={path}
                        >
                          <span
                            className={cn(
                              "truncate font-medium text-foreground",
                              pathLabel ? "max-w-[45%] flex-none" : "min-w-0 flex-1"
                            )}
                          >
                            {fileName}
                          </span>
                          {pathLabel ? (
                            <span className="min-w-0 flex-1 truncate text-muted-foreground/75">
                              {pathLabel}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>

      <div
        data-testid="composer-toolbar"
        className="flex min-w-0 items-center gap-1 px-2.5 pb-2.5 pt-0 [&_svg]:stroke-[1.75]"
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title={t("composer.addContext")}
              className="size-8 flex-none rounded-sm text-foreground hover:bg-canvas-soft-2"
            >
              <PlusIcon className="size-[19px]" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[200px]">
            <DropdownMenuItem onSelect={() => setPlanMode(!planMode)}>
              <ChecklistPlanIcon className="size-4 text-muted-foreground" />
              <span className="flex-1">{t("composer.planModeFull")}</span>
              <Switch
                checked={planMode}
                aria-hidden
                tabIndex={-1}
                className="pointer-events-none data-[state=checked]:bg-hairline-strong"
              />
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void addContext()}>
              <DocumentIcon className="size-4 text-muted-foreground" />
              {t("composer.addFile")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => openSkills(true)}>
              <SkillIcon className="size-4 text-muted-foreground" />
              {t("skills.addCustom")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openSkills(false)}>
              <SkillIcon className="size-4 text-muted-foreground" />
              {t("skills.manage")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {!showVoiceMeter && showProjectSelector ? (
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
              <FolderIcon className="size-4" />
              <span className="min-w-0 flex-1 truncate">
                {activeProject?.name ?? t("composer.conversationMode")}
              </span>
              <ChevronIcon className="size-3.5 flex-none" />
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
                <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
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
                    <FolderIcon className="size-4 text-muted-foreground" />
                    <span className="flex-1 truncate">{project.name}</span>
                    <CheckMediumIcon
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
                <PlusIcon className="size-4 text-muted-foreground" />
                {t("composer.addProject")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem
                  onSelect={() => {
                    setBlankName("");
                    setBlankDialogOpen(true);
                  }}
                >
                  <PlusIcon className="size-4 text-muted-foreground" />
                  {t("composer.createBlankProject")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void openFolder()}>
                  <FolderOpenOutlineIcon className="size-4 text-muted-foreground" />
                  {t("composer.useExistingFolder")}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onSelect={() => setActiveProjectId(undefined)}>
              <FolderOpenOutlineIcon className="size-4 text-muted-foreground" />
              <span className="flex-1 truncate">{t("composer.noProject")}</span>
              <CheckMediumIcon className={cn("size-4", activeProject ? "opacity-0" : "opacity-100")} />
            </DropdownMenuItem>
          </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

        {!showVoiceMeter && planMode ? (
          <button
            type="button"
            title={t("composer.planModeOff")}
            onClick={() => setPlanMode(false)}
            className="flex h-8 flex-none items-center gap-1.5 rounded-sm px-2.5 text-micro font-normal text-muted-foreground transition-colors hover:bg-canvas-soft-2 hover:text-foreground"
          >
            <ChecklistPlanIcon className="size-4" />
            {t("composer.planModeFull")}
          </button>
        ) : null}

        {showVoiceMeter ? null : (
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
                  <ShieldAlertIcon className="size-4" />
                ) : accessMode === "smart_approval" ? (
                  <ShieldTerminalIcon className="size-4" />
                ) : (
                  <HandPointerIcon className="size-4" />
                )}
                {t(
                  accessMode === "full_access"
                    ? "permission.fullAccess"
                    : accessMode === "smart_approval"
                      ? "permission.smartApproval"
                      : "permission.approval"
                )}
                <ChevronIcon className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[280px]">
              <DropdownMenuItem
                className="items-start gap-2.5 py-2.5"
                onSelect={() => void selectAccessMode("approval")}
              >
                <HandPointerIcon
                  className={cn(
                    "mt-0.5 size-4 flex-none",
                    ACCESS_MODE_TONES.approval.menuIcon
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{t("permission.approval")}</span>
                  <span className="mt-0.5 block text-caption leading-snug text-muted-foreground">
                    {t("permission.approvalDesc")}
                  </span>
                </span>
                <CheckMediumIcon
                  className={cn(
                    "mt-0.5 size-4 flex-none",
                    ACCESS_MODE_TONES.approval.check,
                    accessMode === "approval" ? "opacity-100" : "opacity-0"
                  )}
                />
              </DropdownMenuItem>
              <DropdownMenuItem
                className="items-start gap-2.5 py-2.5"
                onSelect={() => void selectAccessMode("smart_approval")}
              >
                <ShieldTerminalIcon
                  className={cn(
                    "mt-0.5 size-4 flex-none",
                    ACCESS_MODE_TONES.smart_approval.menuIcon
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{t("permission.smartApproval")}</span>
                  <span className="mt-0.5 block text-caption leading-snug text-muted-foreground">
                    {t("permission.smartApprovalDesc")}
                  </span>
                </span>
                <CheckMediumIcon
                  className={cn(
                    "mt-0.5 size-4 flex-none",
                    ACCESS_MODE_TONES.smart_approval.check,
                    accessMode === "smart_approval" ? "opacity-100" : "opacity-0"
                  )}
                />
              </DropdownMenuItem>
              <DropdownMenuItem
                className="items-start gap-2.5 py-2.5"
                onSelect={() => void selectAccessMode("full_access")}
              >
                <ShieldAlertIcon
                  className={cn(
                    "mt-0.5 size-4 flex-none",
                    ACCESS_MODE_TONES.full_access.menuIcon
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{t("permission.fullAccess")}</span>
                  <span className="mt-0.5 block text-caption leading-snug text-muted-foreground">
                    {t("permission.fullAccessDesc")}
                  </span>
                </span>
                <CheckMediumIcon
                  className={cn(
                    "mt-0.5 size-4 flex-none",
                    ACCESS_MODE_TONES.full_access.check,
                    accessMode === "full_access" ? "opacity-100" : "opacity-0"
                  )}
                />
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {showVoiceMeter ? (
          <VoiceWaveform
            levels={voiceLevels}
            elapsedMs={voiceElapsedMs}
            state={voiceState}
            onStop={handleVoiceButtonClick}
            stopLabel={String(t("composer.voiceStop"))}
            transcribingLabel={String(t("composer.voiceTranscribing"))}
          />
        ) : (
          <div className="min-w-0 flex-1" />
        )}

        {!showVoiceMeter && activeSessionId && selectedProvider ? (
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

        {showVoiceMeter ? null : configuredProviders.length === 0 ? (
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("composer.selectModel")}
            onClick={openProviderSetupFromComposer}
            className="h-8 min-w-0 max-w-[220px] shrink gap-1.5 rounded-sm px-2.5 text-micro font-normal text-foreground hover:bg-canvas-soft-2"
          >
            <span className="min-w-0 truncate">{t("composer.selectModel")}</span>
            <ChevronIcon className="size-3.5 flex-none" />
          </Button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t("composer.selectModel")}
                className="h-8 min-w-0 max-w-[220px] shrink gap-1.5 rounded-sm px-2.5 text-micro font-normal text-foreground hover:bg-canvas-soft-2"
              >
                <span className="min-w-0 truncate">{selectedModelLabel}</span>
                {hasReasoningSummary && selectedModelOption ? (
                  <span className="flex-none text-muted-foreground">
                    · {reasoningModeSummary(composerT, selectedModelOption, selectedReasoningMode)}
                  </span>
                ) : null}
                <ChevronIcon className="size-3.5 flex-none" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[200px]">
              {/* 左侧弹层平铺可用模型；右侧子菜单可只选模型，也可显式选择推理等级。 */}
              {configuredProviders.flatMap((provider) => {
                const options = withCurrentComposerModel(
                  provider,
                  providerModelOptions[provider.id],
                  provider.id === selectedProvider?.id ? selectedModel : undefined
                );
                return options.map((option) => {
                  const isSelected =
                    provider.id === selectedProvider?.id && option.id === selectedModel;
                  const modelOnlySelected = isSelected && selectedReasoningMode === undefined;
                  return (
                    <DropdownMenuSub key={`${provider.id}:${option.id}`}>
                      <DropdownMenuSubTrigger hideChevron>
                        <span className="flex-1 truncate">{modelOptionLabel(option)}</span>
                        <CheckMediumIcon
                          className={cn(
                            "size-4 flex-none",
                            isSelected ? "opacity-100" : "opacity-0"
                          )}
                        />
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="min-w-[132px]">
                        <DropdownMenuLabel>{t("settings.providers.reasoning")}</DropdownMenuLabel>
                        <DropdownMenuItem
                          onSelect={() => pickComposerModel(provider, option.id, undefined)}
                        >
                          <span className="flex-1">
                            {option.reasoningAlwaysOn
                              ? t("settings.providers.reasoningAlwaysOn")
                              : t("composer.selectModel")}
                          </span>
                          <CheckMediumIcon
                            className={cn(
                              "size-4 flex-none",
                              modelOnlySelected ? "opacity-100" : "opacity-0"
                            )}
                          />
                        </DropdownMenuItem>
                        {option.reasoningModes.length > 0 ? (
                          <>
                            <DropdownMenuSeparator />
                            {option.reasoningModes.map((mode) => (
                              <DropdownMenuItem
                                key={mode}
                                onSelect={() => pickComposerModel(provider, option.id, mode)}
                              >
                                <span className="flex-1">
                                  {reasoningModeLabel(composerT, mode)}
                                </span>
                                <CheckMediumIcon
                                  className={cn(
                                    "size-4 flex-none",
                                    isSelected && selectedReasoningMode === mode
                                      ? "opacity-100"
                                      : "opacity-0"
                                  )}
                                />
                              </DropdownMenuItem>
                            ))}
                          </>
                        ) : null}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  );
                });
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {showVoiceMeter ? null : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={
              voiceState === "unavailable"
                ? String(t("composer.voiceUnavailable"))
                : String(t("composer.voiceStart"))
            }
            title={String(voiceButtonTitle)}
            disabled={voiceButtonDisabled}
            onClick={handleVoiceButtonClick}
            className={cn(
              "size-8 flex-none rounded-sm text-muted-foreground transition-colors hover:bg-canvas-soft-2 hover:text-foreground disabled:bg-transparent disabled:text-muted-foreground/45",
              voiceState === "checking" && "animate-pulse"
            )}
          >
            {voiceState === "unavailable" ? (
              <MicrophoneOffIcon className="size-[18px]" />
            ) : (
              <MicrophoneOutlineIcon className="size-[18px]" />
            )}
          </Button>
        )}

        {showVoiceMeter ? null : currentComposerRunning && !canSend ? (
          <Button
            size="icon"
            className="size-8 flex-none rounded-sm bg-primary text-primary-foreground hover:bg-primary/85"
            title={t("composer.stop")}
            onClick={() => void abortRun()}
          >
            <CircleOutlineIcon className="size-3.5 fill-current" />
          </Button>
        ) : currentComposerRunning ? (
          <Button
            size="icon"
            className="size-8 flex-none rounded-sm bg-primary text-primary-foreground transition-opacity hover:bg-primary/85"
            title={awaitingAskUser ? t("composer.send") : t("composer.queueSend")}
            onClick={() => void submit()}
          >
            <ArrowUpIcon className="size-[18px]" />
          </Button>
        ) : (
          <Button
            size="icon"
            className="size-8 flex-none rounded-sm bg-primary text-primary-foreground transition-opacity hover:bg-primary/85 disabled:bg-muted disabled:text-muted-foreground"
            title={t("composer.send")}
            disabled={!canSend}
            onClick={() => void submit()}
          >
            <ArrowUpIcon className="size-[18px]" />
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
