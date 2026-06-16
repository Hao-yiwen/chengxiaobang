import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SlashCommand } from "@chengxiaobang/shared";
import { useShallow } from "zustand/react/shallow";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SectionShell, SettingBlock } from "@/components/settings/SectionShell";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

const softBluePillClassName =
  "border-soft-blue-border bg-soft-blue-surface text-soft-blue-foreground";

/** 命令设置页：列出所有可用斜杠命令，插件来源的命令可在此单独停用。 */
export function CommandsSection() {
  const { t } = useTranslation();
  const slashCommands = useAppStore(useShallow((state) => state.slashCommands));
  const refreshSlashCommands = useAppStore((state) => state.refreshSlashCommands);

  useEffect(() => {
    console.debug("[commands-section] 进入命令设置页，刷新斜杠命令");
    void refreshSlashCommands();
  }, [refreshSlashCommands]);

  return (
    <SectionShell title={t("settings.commands.title")}>
      <SettingBlock
        title={t("settings.commands.listTitle")}
        description={t("settings.commands.listDesc")}
      >
        <div data-testid="settings-commands-list" className="divide-y rounded-sm border bg-background">
          {slashCommands.length === 0 ? (
            <div className="px-4 py-4 text-caption text-muted-foreground">
              {t("settings.commands.empty")}
            </div>
          ) : (
            slashCommands.map((command) => <CommandRow key={command.id} command={command} />)
          )}
        </div>
      </SettingBlock>
    </SectionShell>
  );
}

function CommandRow(props: { command: SlashCommand }) {
  const { t } = useTranslation();
  const { command } = props;
  const isPlugin = command.source === "plugin";
  // enabled 缺省视为启用；只有插件来源命令显式给出 enabled。
  const enabled = command.enabled !== false;
  const description = command.description || t("composer.slashNoDescription");

  return (
    <div className="grid grid-cols-[minmax(160px,240px)_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5">
      <span
        className="min-w-0 truncate rounded-xs bg-muted px-1.5 py-0.5 font-mono text-micro text-foreground"
        title={command.name}
      >
        {command.name}
      </span>
      <div className="flex min-w-0 items-center gap-2 overflow-hidden text-caption text-muted-foreground">
        <CommandDescriptionTooltip
          description={description}
          argumentHint={command.argumentHint}
        />
        {command.argumentHint ? (
          <span
            className="max-w-[120px] flex-none truncate font-mono text-micro text-mute"
            title={command.argumentHint}
          >
            {command.argumentHint}
          </span>
        ) : null}
        <SourceBadge command={command} />
        <KindBadge kind={command.kind} />
        {isPlugin && !enabled ? (
          <Badge
            variant="outline"
            className="h-4 max-w-[88px] flex-none truncate px-1.5 py-0 text-[11px] leading-4 text-muted-foreground"
          >
            {t("skills.disabledTag")}
          </Badge>
        ) : null}
      </div>
      <div className="flex justify-end">
        {isPlugin ? <CommandToggle command={command} enabled={enabled} /> : null}
      </div>
    </div>
  );
}

function CommandDescriptionTooltip(props: { description: string; argumentHint?: string }) {
  const { description, argumentHint } = props;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="block min-w-0 flex-1 truncate">{description}</span>
      </TooltipTrigger>
      <TooltipContent
        align="start"
        className="max-w-[460px] whitespace-normal text-left leading-5"
      >
        <span>{description}</span>
        {argumentHint ? (
          <span className="mt-1 block font-mono text-[11px] opacity-80">{argumentHint}</span>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}

function SourceBadge(props: { command: SlashCommand }) {
  const { t } = useTranslation();
  const { command } = props;
  const label =
    command.source === "plugin" && command.pluginName
      ? t("skills.fromPlugin", { name: command.pluginName })
      : t(`composer.slashSource.${command.source}`);
  const badgeClassName =
    command.source === "builtin"
      ? "border-emerald-500/20 bg-emerald-50 text-emerald-700"
      : softBluePillClassName;
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-4 max-w-[160px] flex-none truncate px-1.5 py-0 text-[11px] leading-4",
        badgeClassName
      )}
      title={label}
    >
      {label}
    </Badge>
  );
}

function KindBadge(props: { kind: SlashCommand["kind"] }) {
  const { t } = useTranslation();
  return (
    <Badge
      variant="secondary"
      className="h-4 flex-none px-1.5 py-0 text-[11px] leading-4 text-muted-foreground"
    >
      {t(`settings.commands.kind.${props.kind}`)}
    </Badge>
  );
}

/**
 * 插件来源命令的停用开关：
 * kind=skill 走 setSkillDisabled（技能命令），kind=prompt_template 走 setCommandDisabled。
 * builtin_tool 类不应出现在插件来源里，保守起见不渲染开关。
 */
function CommandToggle(props: { command: SlashCommand; enabled: boolean }) {
  const { t } = useTranslation();
  const { command, enabled } = props;
  const setSkillDisabled = useAppStore((state) => state.setSkillDisabled);
  const setCommandDisabled = useAppStore((state) => state.setCommandDisabled);
  const setNotice = useAppStore((state) => state.setNotice);
  const [busy, setBusy] = useState(false);

  const toggleable = command.kind === "skill" || command.kind === "prompt_template";
  if (!toggleable) {
    return null;
  }

  async function toggle(nextEnabled: boolean): Promise<void> {
    if (busy) {
      return;
    }
    setBusy(true);
    const disabled = !nextEnabled;
    console.info("[commands-section] 切换插件命令停用态", {
      name: command.name,
      kind: command.kind,
      disabled
    });
    try {
      // 技能命令名带前导斜杠；停用接口按技能名定位，去掉 "/" 前缀。
      const bareName = command.name.replace(/^\//, "");
      if (command.kind === "skill") {
        await setSkillDisabled(bareName, disabled);
      } else {
        await setCommandDisabled(bareName, disabled);
      }
    } catch (error) {
      console.error("[commands-section] 切换插件命令停用态失败", {
        name: command.name,
        disabled,
        error
      });
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Switch
      checked={enabled}
      disabled={busy}
      aria-label={t(enabled ? "skills.disablePlugin" : "skills.enablePlugin")}
      onCheckedChange={(checked) => void toggle(checked)}
    />
  );
}
