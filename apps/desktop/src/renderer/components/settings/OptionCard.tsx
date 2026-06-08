import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function OptionCard(props: {
  selected: boolean;
  icon: ReactNode;
  title: string;
  description: string;
  onSelect(): void;
}) {
  return (
    <button
      type="button"
      onClick={props.onSelect}
      className={cn(
        "flex flex-1 items-start gap-3 rounded-xl border p-4 text-left transition-all",
        props.selected
          ? "border-brand/50 bg-brand-soft/50 ring-1 ring-brand/30"
          : "border-border hover:border-border hover:bg-accent/50"
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-8 flex-none items-center justify-center rounded-lg transition-colors [&_svg]:size-[18px]",
          props.selected ? "bg-brand/15 text-brand" : "bg-muted text-foreground"
        )}
      >
        {props.icon}
      </span>
      <span className="flex-1">
        <span className="block text-sm font-medium">{props.title}</span>
        <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">
          {props.description}
        </span>
      </span>
      <span
        className={cn(
          "mt-0.5 flex size-[18px] flex-none items-center justify-center rounded-full border-2 transition-colors",
          props.selected ? "border-brand" : "border-muted-foreground/40"
        )}
      >
        {props.selected ? <span className="size-2 rounded-full bg-brand" /> : null}
      </span>
    </button>
  );
}
