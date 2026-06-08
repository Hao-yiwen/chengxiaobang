import {
  Bug,
  FileCode2,
  FileText,
  FlaskConical,
  Presentation,
  Wand2,
  type LucideIcon
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store";

/**
 * Quick-start prompt chips shown on the empty home screen. Clicking one seeds
 * the composer with a starter prompt and focuses it, so the welcome view feels
 * inviting instead of blank. Purely a launcher — the user edits before sending.
 */
const STARTERS: {
  key: "ppt" | "doc" | "explain" | "test" | "refactor" | "debug";
  icon: LucideIcon;
}[] = [
  { key: "ppt", icon: Presentation },
  { key: "doc", icon: FileText },
  { key: "explain", icon: FileCode2 },
  { key: "test", icon: FlaskConical },
  { key: "refactor", icon: Wand2 },
  { key: "debug", icon: Bug }
];

export function HomeStarters() {
  const { t } = useTranslation();
  const setInput = useAppStore((state) => state.setInput);

  function pick(prompt: string): void {
    setInput(prompt);
    window.requestAnimationFrame(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>("textarea");
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(prompt.length, prompt.length);
      }
    });
  }

  return (
    <div className="mt-5 flex w-[min(760px,100%)] flex-wrap justify-center gap-2">
      {STARTERS.map(({ key, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => pick(t(`home.starters.${key}Prompt` as const))}
          className="group flex items-center gap-2 rounded-full border bg-card px-3.5 py-2 text-[13px] font-medium text-muted-foreground shadow-soft transition-all hover:-translate-y-0.5 hover:border-brand/30 hover:text-foreground hover:shadow-elevated"
        >
          <Icon className="size-4 text-brand/70 transition-colors group-hover:text-brand" />
          {t(`home.starters.${key}Title` as const)}
        </button>
      ))}
    </div>
  );
}
