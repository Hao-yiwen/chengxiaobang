import { cn } from "@/lib/utils";

/**
 * The 程小帮 brand mark — a friendly, symmetric robot face in the app's
 * teal/amber identity: a centered antenna, a rounded "screen" face with two
 * amber eyes and a smile, and a pair of side ears. Rendered inline so it stays
 * crisp at every size (64px on the welcome screen down to 22px in the chrome).
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      className={cn("size-8", className)}
      role="img"
      aria-hidden="true"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* antenna */}
      <path
        d="M512 226V152"
        stroke="hsl(var(--brand))"
        strokeWidth="30"
        strokeLinecap="round"
      />
      <circle cx="512" cy="128" r="38" fill="hsl(var(--accent-amber))" />

      {/* side ears */}
      <rect x="200" y="436" width="44" height="120" rx="22" fill="hsl(var(--brand))" />
      <rect x="780" y="436" width="44" height="120" rx="22" fill="hsl(var(--brand))" />

      {/* head */}
      <rect x="236" y="226" width="552" height="540" rx="160" fill="hsl(var(--brand))" />

      {/* face screen */}
      <rect x="304" y="298" width="416" height="396" rx="120" fill="hsl(var(--brand-soft))" />

      {/* eyes */}
      <circle cx="430" cy="452" r="44" fill="hsl(var(--accent-amber))" />
      <circle cx="594" cy="452" r="44" fill="hsl(var(--accent-amber))" />

      {/* smile */}
      <path
        d="M446 566Q512 620 578 566"
        stroke="hsl(var(--brand))"
        strokeWidth="34"
        strokeLinecap="round"
      />
    </svg>
  );
}
