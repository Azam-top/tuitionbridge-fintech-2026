import { useState } from "react";
import type { Proposal, RouteRow } from "./api";
import { Chip } from "./components";
import { fmtRelative, fmtTime, formatUsd } from "./format";
import { Icon } from "./icons";
import { iconForRoute, providerParts, SOURCE_NAME } from "./plan";

/** Height-animated disclosure (150-350ms; instant under reduced motion). Content is inert while closed. */
export function Reveal({ open, id, children }: { open: boolean; id: string; children: React.ReactNode }) {
  return (
    <div className="reveal" data-open={open} id={id} role="region" aria-hidden={!open}>
      <div className="reveal-inner">{children}</div>
    </div>
  );
}

function RouteDetails({ r, now }: { r: RouteRow; now: string }) {
  return (
    <>
      <dl className="kv">
        <div><dt>University receives</dt><dd className="num">{r.recipientWillReceive}{r.roundingSurplus !== "KZT 0.00" && <small className="muted"> (incl. {r.roundingSurplus} rounding)</small>}</dd></div>
        <div><dt>Fee</dt><dd className="num">{r.fee}</dd></div>
        <div><dt>USD left after paying</dt><dd className="num">{r.usdAfterPayment}</dd></div>
        <div><dt>Expected arrival</dt><dd title={r.estArrivalAt}>{fmtTime(r.estArrivalAt)} <small className="muted">({fmtRelative(r.estArrivalAt, now)})</small></dd></div>
        <div><dt>Valid until</dt><dd>{fmtTime(r.expiresAt)}</dd></div>
        <div><dt>Source</dt><dd>{r.source ? (SOURCE_NAME[r.source] ?? r.source) : "unknown"}{r.source === "USER_DECLARED" && r.sourceNote ? <small className="muted block">{r.sourceNote}</small> : null}</dd></div>
        <div><dt>Rate shown</dt><dd className="num">{r.rate ? `${r.rate} KZT per USD` : "unknown"}</dd></div>
      </dl>
      {!r.feasible && (
        <ul className="reasons" aria-label="Why this route is excluded">
          {r.exclusions.map((e, k) => <li key={k}><Chip tone="bad">{e.code.replace(/_/g, " ")}</Chip> {e.message}</li>)}
        </ul>
      )}
      {r.source === "USER_DECLARED" && <p className="muted small">You entered this offer; TuitionBridge cannot check it with the bank.</p>}
    </>
  );
}

const providerShortName = (n: string): string => { const p = providerParts(n); return p.method ? `${p.title} ${p.method}` : p.title; };

export function RoutePicker({ routes, best, proposal, nowMs, now, live, selectedId, onSelect }: {
  routes: RouteRow[]; best: string | null; proposal: Proposal | null; nowMs: number; now: string; live: boolean; selectedId: string | null; onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const qualifying = routes.filter((r) => r.feasible).length;
  return (
    <section className="card routes-card" id="routes" aria-labelledby="routes-h">
      <header className="card-head">
        <h2 id="routes-h">Compare options</h2>
        <span className="muted small" data-testid="route-count">
          {routes.length === 0 ? "No options" : `${routes.length} ${routes.length === 1 ? "option" : "options"} · ${qualifying} qualify`}
        </span>
      </header>
      <fieldset className="route-list" data-testid="routes-table">
        <legend className="sr-only">Transfer options. Selecting one shows its details; the plan covers the recommended option.</legend>
        {routes.map((r) => {
          const kind = r.feasible ? (r.quoteId === best ? "best" : "ok") : "excluded";
          const expired = Date.parse(r.expiresAt) <= nowMs;
          const selected = selectedId === r.quoteId;
          const dId = `route-d-${r.quoteId}`;
          return (
            <div key={r.quoteId} className={`route route-${kind}${selected ? " selected" : ""}`} data-testid={`route-${kind}`}>
              <div className="route-head">
                <label className="route-pick">
                  <input type="radio" name="route" className="sr-only" checked={selected} onChange={() => onSelect(r.quoteId)} />
                  <span className="radio-dot" aria-hidden="true" />
                  <span className="tile" aria-hidden="true"><Icon name={iconForRoute(r)} size={20} /></span>
                  <span className="route-main">
                    <strong>{providerParts(r.provider).title}{providerParts(r.provider).method && <span className="muted"> · {providerParts(r.provider).method}</span>}</strong>
                    <span className="muted small">
                      {!live && r.source === "SIMULATED" ? "Sandbox test quote · " : ""}Arrives about {fmtTime(r.estArrivalAt)}
                    </span>
                    <span className="chips-inline">
                      {kind === "best" && <Chip tone="accent">Best fit</Chip>}
                      {kind === "ok" && <Chip tone="info">Also qualifies</Chip>}
                      {!r.feasible && r.exclusions.map((e, k) => <Chip key={k} tone="bad">{e.code.replace(/_/g, " ")}</Chip>)}
                      {expired && <Chip tone="bad">Offer expired</Chip>}
                    </span>
                  </span>
                  <span className="route-price">
                    <strong className="num">{r.totalDebit}</strong>
                    <span className="muted small num">incl. {r.fee} fee</span>
                  </span>
                </label>
                <button type="button" className="icon-btn" aria-expanded={open === r.quoteId} aria-controls={dId} aria-label={`${open === r.quoteId ? "Hide" : "Show"} details for ${providerShortName(r.provider)}`} onClick={() => setOpen(open === r.quoteId ? null : r.quoteId)}>
                  <Icon name="chevronDown" size={18} className="chev" />
                </button>
              </div>
              <Reveal open={open === r.quoteId} id={dId}><RouteDetails r={r} now={now} /></Reveal>
            </div>
          );
        })}
      </fieldset>
      {!best && <p className="alert" role="alert" data-testid="no-route"><Icon name="alert" size={18} /> No option qualifies right now. Each option shows why.</p>}
    </section>
  );
}

const pct = (part: bigint, whole: bigint): string => (whole === 0n ? "0.0" : (Number((part * 10000n) / whole) / 100).toFixed(1));

/** "Your budget, protected": how the declared USD splits into this payment, the protected reserve and what stays free. */
export function ProtectedBudget({ balanceCents, totalCents, reserveCents }: { balanceCents: string; totalCents: string; reserveCents: string }) {
  const balance = BigInt(balanceCents); const total = BigInt(totalCents); const reserve = BigInt(reserveCents);
  const free = balance - total - reserve;
  const short = free < 0n;
  const w = (v: bigint) => (balance === 0n ? 0 : Math.max(0, Math.min(100, Number((v * 10000n) / balance) / 100)));
  const freeShown = short ? 0n : free;
  return (
    <section className="card budget-card" aria-labelledby="budget-h" data-testid="budget-card">
      <header className="card-head">
        <div className="head-with-tile"><span className="tile" aria-hidden="true"><Icon name="wallet" size={20} /></span><div><h2 id="budget-h">Your budget</h2></div></div>
        <div className="head-figure"><span className="muted small">Funds</span><strong className="num">{formatUsd(balanceCents)}</strong></div>
      </header>
      <div className="bar" role="img" aria-label={`Of ${formatUsd(balanceCents)}: this payment ${formatUsd(totalCents)}, protected ${formatUsd(reserveCents)}, free ${short ? "none; short by " + formatUsd(-free) : formatUsd(freeShown)}`}>
        <span className="seg seg-pay" style={{ width: `${w(total)}%` }} />
        <span className="seg seg-keep" style={{ width: `${w(reserve)}%` }} />
        <span className="seg seg-free" style={{ width: `${w(freeShown)}%` }} />
      </div>
      <ul className="legend">
        <li><span className="swatch seg-pay" /><span className="muted small">This payment</span><strong className="num">{formatUsd(totalCents)}</strong><span className="muted small num">{pct(total, balance)}%</span></li>
        <li><span className="swatch seg-keep" /><span className="muted small">Living reserve</span><strong className="num">{formatUsd(reserveCents)}</strong><span className="muted small num">{pct(reserve, balance)}%</span></li>
        <li><span className="swatch seg-free" /><span className="muted small">Left over</span><strong className="num">{short ? "none" : formatUsd(freeShown)}</strong><span className="muted small num">{short ? "" : `${pct(freeShown, balance)}%`}</span></li>
      </ul>
      {short && <p className="alert" role="alert"><Icon name="alert" size={18} /> Not enough money: this option would leave you {formatUsd(-free)} short of your living reserve.</p>}
    </section>
  );
}
