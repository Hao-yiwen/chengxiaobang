import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type OptionCardTone = "neutral" | "info" | "warning";

const OPTION_CARD_TONES: Record<
  OptionCardTone,
  {
    selectedCard: string;
    idleIcon: string;
    selectedIcon: string;
    selectedCheck: string;
  }
> = {
  neutral: {
    selectedCard: "border-border bg-hairline",
    idleIcon: "bg-canvas-soft-2 text-muted-foreground",
    selectedIcon: "bg-canvas-soft-2 text-muted-foreground",
    selectedCheck: "border-muted-foreground"
  },
  info: {
    selectedCard: "border-link/30 bg-link-bg-soft/55",
    idleIcon: "bg-link-bg-soft text-link",
    selectedIcon: "bg-link text-primary-foreground",
    selectedCheck: "border-link"
  },
  warning: {
    selectedCard: "border-[#d25f28]/40 bg-[#d25f28]/10",
    idleIcon: "bg-[#d25f28]/10 text-[#d25f28]",
    selectedIcon: "bg-[#d25f28] text-white",
    selectedCheck: "border-[#d25f28]"
  }
};

export function OptionCard(props: {
  selected: boolean;
  icon: ReactNode;
  title: string;
  description: string;
  tone?: OptionCardTone;
  onSelect(): void;
}) {
  const tone = OPTION_CARD_TONES[props.tone ?? "neutral"];
  return (
    <button
      type="button"
      onClick={props.onSelect}
      className={cn(
        "flex flex-1 items-start gap-3 rounded-sm border p-4 text-left transition-colors",
        props.selected ? tone.selectedCard : "border-border bg-canvas hover:bg-canvas-soft-2"
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-8 flex-none items-center justify-center rounded-xs transition-colors [&_svg]:size-[18px]",
          props.selected ? tone.selectedIcon : tone.idleIcon
        )}
      >
        {props.icon}
      </span>
      <span className="flex-1">
        <span className="block text-caption font-medium">{props.title}</span>
        <span className="mt-0.5 block text-micro leading-snug text-muted-foreground">
          {props.description}
        </span>
      </span>
      <span
        className={cn(
          "mt-0.5 flex size-[18px] flex-none items-center justify-center rounded-full border transition-colors",
          props.selected ? tone.selectedCheck : "border-muted-foreground/40"
        )}
      >
        {props.selected ? (
          <span
            className={cn(
              "size-2 rounded-full",
              props.tone === "info"
                ? "bg-link"
                : props.tone === "warning"
                  ? "bg-[#d25f28]"
                  : "bg-muted-foreground"
            )}
          />
        ) : null}
      </span>
    </button>
  );
}
