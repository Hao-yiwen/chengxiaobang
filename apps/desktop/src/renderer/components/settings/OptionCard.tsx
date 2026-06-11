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
        "flex flex-1 items-start gap-3 rounded-sm border p-4 text-left transition-all",
        props.selected
          ? "border-primary ring-1 ring-primary"
          : "border-border hover:bg-accent/50"
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-8 flex-none items-center justify-center rounded-xs transition-colors [&_svg]:size-[18px]",
          props.selected
            ? "bg-primary text-primary-foreground"
            : "bg-soft-stone text-ink"
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
          "mt-0.5 flex size-[18px] flex-none items-center justify-center rounded-full border-2 transition-colors",
          props.selected ? "border-primary" : "border-muted-foreground/40"
        )}
      >
        {props.selected ? <span className="size-2 rounded-full bg-primary" /> : null}
      </span>
    </button>
  );
}
