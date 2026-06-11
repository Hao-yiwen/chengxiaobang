import { cn } from "@/lib/utils";

/**
 * The 程小帮 brand mark — a monochrome rounded square holding a `</>` code
 * glyph. The square uses `currentColor` (foreground by default) and the glyph
 * uses the theme background, so the mark stays pure black & white and inverts
 * cleanly in dark mode. Rendered inline so it stays crisp from 16px to 64px.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      className={cn("size-8 text-foreground", className)}
      role="img"
      aria-hidden="true"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="64" y="64" width="896" height="896" rx="236" fill="currentColor" />
      <g
        stroke="rgb(var(--background))"
        strokeWidth="78"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M384 376 L248 512 L384 648" />
        <path d="M640 376 L776 512 L640 648" />
        <path d="M556 340 L468 684" />
      </g>
    </svg>
  );
}
