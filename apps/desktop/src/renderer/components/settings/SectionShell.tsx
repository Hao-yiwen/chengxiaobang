import type { ReactNode } from "react";

/** Shared chrome for a settings section: page title + stacked blocks. */
export function SectionShell(props: { title: string; children: ReactNode }) {
  return (
    <section>
      <h1 className="mb-8 text-2xl font-semibold tracking-tight">{props.title}</h1>
      <div className="space-y-10">{props.children}</div>
    </section>
  );
}

export function SettingBlock(props: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <h2 className="text-base font-semibold">{props.title}</h2>
      {props.description ? (
        <p className="mb-3 mt-1 text-sm text-muted-foreground">{props.description}</p>
      ) : (
        <div className="mb-3" />
      )}
      {props.children}
    </div>
  );
}
