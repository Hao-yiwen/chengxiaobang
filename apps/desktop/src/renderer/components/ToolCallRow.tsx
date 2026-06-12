import {
  CheckIcon as Check,
  CircleNotchIcon as Loader2,
  XIcon as X
} from "@phosphor-icons/react";
import type { ToolCall } from "@chengxiaobang/shared";
import { ArtifactCard } from "@/components/ArtifactCard";
import { ToolCallLine } from "@/components/ToolCallLine";
import { artifactFromToolCall, type ArtifactKind } from "@/lib/artifact";

interface ToolCallRowProps {
  toolCall: ToolCall;
  onOpenFile?: (path: string, kind: ArtifactKind) => void;
}

/**
 * One standalone tool invocation in the timeline. Generated deliverables
 * render as an ArtifactCard (clickable → right preview); ask_user/use_skill
 * keep their dedicated shapes; every other tool is a borderless ToolCallLine
 * (icon + muted description, expandable to its raw result or diff), aligned
 * with the reasoning panel headers.
 */
export function ToolCallRow({ toolCall, onOpenFile }: ToolCallRowProps) {
  const artifact = artifactFromToolCall(toolCall);
  if (artifact) {
    return <ArtifactCard artifact={artifact} toolName={toolCall.name} />;
  }

  if (toolCall.name === "ask_user") {
    return <AskUserReceipt toolCall={toolCall} />;
  }

  if (toolCall.name === "use_skill") {
    return <UseSkillChip toolCall={toolCall} />;
  }

  return (
    <div className="mb-4 max-w-full self-stretch">
      <ToolCallLine toolCall={toolCall} onOpenFile={onOpenFile} />
    </div>
  );
}

function textArg(toolCall: ToolCall, key: string): string | undefined {
  const value = toolCall.args[key];
  return typeof value === "string" ? value : undefined;
}

function ToolStatusIcon({ toolCall }: { toolCall: ToolCall }) {
  const isRunning = toolCall.status === "running" || toolCall.status === "pending_approval";
  const isError = toolCall.status === "failed" || toolCall.status === "rejected";

  if (isRunning) {
    return <Loader2 className="size-3.5 flex-none animate-spin text-muted-foreground" />;
  }
  if (isError) {
    return <X className="size-3.5 flex-none text-destructive" />;
  }
  return <Check className="size-3.5 flex-none text-muted-foreground" />;
}

function AskUserReceipt({ toolCall }: { toolCall: ToolCall }) {
  const question = textArg(toolCall, "question") ?? "问题";
  const answer =
    toolCall.status === "completed" && toolCall.result ? toolCall.result : answerTextFor(toolCall.status);

  return (
    <div className="mb-1.5 max-w-full self-start overflow-hidden rounded-sm border bg-card">
      <div className="flex min-w-0 items-center gap-2 px-3 py-1.5 font-mono text-micro">
        <ToolStatusIcon toolCall={toolCall} />
        <span className="font-medium uppercase tracking-[0.28px] text-foreground">{toolCall.name}</span>
      </div>
      <div className="space-y-1 border-t bg-background px-3 py-2 text-micro leading-relaxed text-muted-foreground">
        <p className="min-w-0 break-words">问：{question}</p>
        <p className="min-w-0 break-words">答：{answer}</p>
      </div>
    </div>
  );
}

function answerTextFor(status: ToolCall["status"]): string {
  if (status === "rejected") {
    return "用户跳过了该问题";
  }
  if (status === "pending_approval" || status === "running") {
    return "问题未回答（运行已结束）";
  }
  return "无回答";
}

function UseSkillChip({ toolCall }: { toolCall: ToolCall }) {
  const skillName = textArg(toolCall, "name") ?? "unknown";
  const failed = toolCall.status === "failed";
  const label =
    toolCall.status === "running" || toolCall.status === "pending_approval"
      ? "正在加载技能"
      : failed
        ? "加载技能失败"
        : "已加载技能";

  return (
    <div className="mb-4 max-w-full self-stretch">
      <div className="flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
        <ToolStatusIcon toolCall={toolCall} />
        <span className="min-w-0 truncate">
          {label} {skillName}
        </span>
      </div>
      {failed && toolCall.result ? (
        <pre className="mt-1 max-h-[220px] overflow-auto whitespace-pre-wrap break-words rounded-sm bg-muted/50 px-3 py-2 font-mono text-micro leading-relaxed text-destructive">
          {toolCall.result}
        </pre>
      ) : null}
    </div>
  );
}
