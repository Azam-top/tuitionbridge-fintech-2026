import { useState, type ReactNode } from "react";
import type { Config } from "./api";

export function Badge({ tone, label, value, title }: { tone: "teal" | "amber" | "ink" | "violet"; label: string; value: string; title?: string }) {
  return (
    <span className={`badge badge-${tone}`} title={title} data-testid={`badge-${label.toLowerCase()}`}>
      <span className="badge-label">{label}</span>
      <strong>{value}</strong>
    </span>
  );
}

export function ModeBadges({ config }: { config: Config | null }) {
  if (!config) return null;
  const live = config.agentMode === "LIVE";
  return (
    <div className="badges" role="group" aria-label="Operating modes">
      <Badge
        tone={live ? "teal" : "amber"}
        label="Agent"
        value={live ? (config.liveVerifiedInThisDatabase ? "LIVE" : "LIVE (unverified)") : "MOCK"}
        title={live ? "A real model adapter is configured." : "No model key configured: a deterministic stand-in drives the same tools. This is not a live model run."}
      />
      <Badge tone="ink" label="Payments" value="SIMULATED" title="No real money moves. All providers, quotes and ledgers are synthetic." />
      {config.replay && <Badge tone="violet" label="Replay" value="OFFLINE RECORD" title="This view shows a recorded run, not a live one." />}
    </div>
  );
}

export function Card({ title, children, aside, id }: { title: string; children: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <section className="card" aria-labelledby={id ? `${id}-h` : undefined} id={id}>
      <header className="card-head">
        <h2 id={id ? `${id}-h` : undefined}>{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function Row({ label, children, strong, testId }: { label: string; children: ReactNode; strong?: boolean; testId?: string }) {
  return (
    <div className={`row${strong ? " row-strong" : ""}`} data-testid={testId}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function Chip({ tone, children }: { tone: "ok" | "warn" | "bad" | "info" | "muted"; children: ReactNode }) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

export function Details({ summary, children }: { summary: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} className="details">
      <summary>{summary}</summary>
      {open && children}
    </details>
  );
}
