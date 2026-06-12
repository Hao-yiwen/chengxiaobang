import type { ReactNode } from "react";

/** Shared chrome for a settings section: page title + stacked blocks. */
export function SectionShell(props: { title: string; children: ReactNode }) {
  return (
    <section>
      <h1 className="mb-8 font-display text-card-heading font-normal">{props.title}</h1>
      <div className="space-y-0 border-t">{props.children}</div>
    </section>
  );
}

export function SettingBlock(props: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-4 border-b py-8">
      <div>
        <h2 className="text-body-lg font-medium">{props.title}</h2>
        {props.description ? (
          <p className="mt-1 text-caption text-muted-foreground">{props.description}</p>
        ) : null}
      </div>
      {props.children}
    </div>
  );
}
