import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  resolveProviderModelOption,
  type ProviderKind,
  type ProviderModelOption,
  type ReasoningMode
} from "@chengxiaobang/shared";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const DEFAULT_REASONING_VALUE = "__default__";

export function reasoningModeLabel(t: TFunction, mode: ReasoningMode): string {
  return t(`settings.providers.reasoningModes.${mode}`);
}

export function reasoningModeSummary(
  t: TFunction,
  model: ProviderModelOption,
  mode?: ReasoningMode
): string {
  if (mode) {
    return reasoningModeLabel(t, mode);
  }
  if (model.reasoningAlwaysOn) {
    return t("settings.providers.reasoningAlwaysOn");
  }
  return t("settings.providers.reasoningDefault");
}

export function supportedReasoningMode(
  kind: ProviderKind,
  model: string,
  mode?: ReasoningMode
): ReasoningMode | undefined {
  if (!mode) {
    return undefined;
  }
  const option = resolveProviderModelOption(kind, model);
  return option.reasoningModes.includes(mode) ? mode : undefined;
}

export function ReasoningModeSelect(props: {
  kind: ProviderKind;
  model: string;
  value?: ReasoningMode;
  onValueChange(value: ReasoningMode | undefined): void;
  className?: string;
  triggerClassName?: string;
  compact?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const option = resolveProviderModelOption(props.kind, props.model);
  const modes = option.reasoningModes;
  if (modes.length === 0) {
    const label = option.reasoningAlwaysOn
      ? t("settings.providers.reasoningAlwaysOn")
      : t("settings.providers.reasoningDefault");
    return (
      <div
        className={cn(
          "flex h-9 items-center rounded-xs border border-input bg-transparent px-3 text-caption text-muted-foreground",
          props.compact && "h-8 border-0 px-2.5 text-micro",
          props.className,
          props.triggerClassName
        )}
      >
        {label}
      </div>
    );
  }
  return (
    <Select
      value={props.value ?? DEFAULT_REASONING_VALUE}
      disabled={props.disabled}
      onValueChange={(value) =>
        props.onValueChange(
          value === DEFAULT_REASONING_VALUE ? undefined : (value as ReasoningMode)
        )
      }
    >
      <SelectTrigger className={props.triggerClassName}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className={props.className}>
        <SelectItem value={DEFAULT_REASONING_VALUE}>
          {t("settings.providers.reasoningDefault")}
        </SelectItem>
        {modes.map((mode) => (
          <SelectItem key={mode} value={mode}>
            {reasoningModeLabel(t, mode)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
