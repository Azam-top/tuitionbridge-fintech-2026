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
  const live = config.appMode === "live";
  const agent = config.agentStatus;
  return (
    <div className="badges" role="group" aria-label="Operating modes">
      <Badge
        tone={live ? "teal" : "amber"} label="Mode" value={live ? "LIVE" : "SANDBOX"}
        title={live ? "Real accounts, real invoices and real sources. Nothing here is test data." : "Separate database of fictional test data for the competition check. This is not the real application mode."}
      />
      <Badge
        tone={agent === "LIVE" ? "teal" : agent === "MOCK" ? "amber" : "ink"} label="Agent"
        value={agent === "LIVE" ? (config.liveVerifiedInThisDatabase ? "LIVE" : "LIVE (unverified)") : agent === "MOCK" ? "MOCK" : "NOT CONFIGURED"}
        title={agent === "LIVE" ? `A real model adapter is configured${config.llmModel ? ` (${config.llmModel})` : ""}.` : agent === "MOCK" ? "No model key: a deterministic stand-in drives the same tools (sandbox only). Not a live model run." : "No model configured. Planning is disabled until you set APP_LLM_API_KEY and APP_LLM_MODEL."}
      />
      <Badge
        tone="ink" label="Payments" value={config.payments === "SIMULATED" ? "SIMULATED" : "NOT MOVED BY APP"}
        title={config.payments === "SIMULATED" ? "No real money moves. All providers, quotes and ledgers are synthetic." : "The app issues a payment instruction. You pay outside the app; the app never moves money."}
      />
      {config.replay && <Badge tone="violet" label="Replay" value="OFFLINE RECORD" title="This view shows a recorded run, not a live one." />}
    </div>
  );
}

export function Card({ title, children, aside, id, className = "" }: { title: string; children: ReactNode; aside?: ReactNode; id?: string; className?: string }) {
  return (
    <section className={`card ${className}`.trim()} aria-labelledby={id ? `${id}-h` : undefined} id={id}>
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

export function Chip({ tone, children }: { tone: "ok" | "warn" | "bad" | "info" | "muted" | "accent"; children: ReactNode }) {
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

/** Operating facts for people who want them (and for reviewers). Collapsed by default: the main screens stay about the payment. */
export function TechnicalDetails({ config }: { config: Config | null }) {
  if (!config) return null;
  const live = config.appMode === "live";
  return (
    <details className="card tech" data-testid="tech-details">
      <summary>Technical details</summary>
      <ModeBadges config={config} />
      <dl className="rows tech-rows">
        <Row label="AI model">{config.agentStatus === "NOT_CONFIGURED" ? "not configured" : config.llmModel ?? (config.agentStatus === "MOCK" ? "MOCK stand-in (sandbox only)" : "unknown")}</Row>
        <Row label="Payments">{live ? "The app never moves money; it issues payment instructions." : "Simulated in a test ledger."}</Row>
        <Row label="Run limits">{config.limits.maxToolCalls} tool calls, {config.limits.maxModelRequests} model requests, {config.limits.maxTransientRetries} retries per plan</Row>
        {live && <Row label="Wise quotes">{config.wiseQuotes ? "fetched by the server when you plan" : "switched off (APP_WISE_QUOTES)"}</Row>}
      </dl>
    </details>
  );
}
