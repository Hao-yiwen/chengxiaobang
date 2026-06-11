import type { ReactNode } from "react";

/** Shared chrome for a settings section: page title + stacked blocks. */
export function SectionShell(props: { title: string; children: ReactNode }) {
  return (
    <section>
      <h1 className="mb-8 font-display text-card-heading font-normal">{props.title}</h1>
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
      <h2 className="text-body-lg font-medium">{props.title}</h2>
      {props.description ? (
        <p className="mb-3 mt-1 text-caption text-muted-foreground">{props.description}</p>
      ) : (
        <div className="mb-3" />
      )}
      {props.children}
    </div>
  );
}
