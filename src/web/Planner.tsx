import { useEffect, useState } from "react";
import type { Balances, Config, Invoice, Proposal, RouteRow, TaskView } from "./api";
import { Chip } from "./components";
import { diagnose, type Problem } from "./problems";
import { fmtTime, formatKzt, formatUsd, kztToTiyn, tiynToInput } from "./format";
import { Icon, type IconName } from "./icons";
import { openManualOffer } from "./LivePanels";
import { arrivalLine, buildInstruction, diffText, providerParts, providerShort, sourceDetail, span, type Preference } from "./plan";

export const EXAMPLES = [
  "Pay this invoice by its deadline, use the cheapest feasible route, and keep USD 300 for living costs.",
  "Pay this invoice by its deadline, prefer faster arrival, and keep USD 300 for living costs.",
  "Оплати счёт до срока, выбери самый дешёвый вариант и оставь 300 долларов на жизнь.",
];

const STATE_TEXT: Record<string, { tone: "ok" | "warn" | "bad" | "info" | "muted"; text: string }> = {
  RUNNING: { tone: "info", text: "Working on it" },
  AWAITING_APPROVAL: { tone: "warn", text: "Ready for your decision" },
  EXECUTING: { tone: "info", text: "Recording (simulated)" },
  APPROVED: { tone: "ok", text: "Instruction ready" },
  COMPLETED: { tone: "ok", text: "Completed (simulated)" },
  BLOCKED: { tone: "bad", text: "No plan" },
  FAILED: { tone: "bad", text: "Plan stopped" },
  CANCELLED: { tone: "muted", text: "Cancelled" },
};

const TOOL_PHRASE: Record<string, string> = {
  parse_invoice: "Read your invoice", get_balances: "Checked your funds", get_quotes: "Collected the offers",
  evaluate_routes: "Compared the options", prepare_payment: "Prepared the plan", execute_sandbox_payment: "Recorded the sandbox payment",
};

/** Server progress notes -> plain steps. Anything else (raw notes with rates, dates, counts) is not shown here. */
function stepFromInfo(t: string): string | null {
  if (/^Official reference rate/i.test(t)) return "Checked the National Bank reference rate";
  if (/^Provider quotes:\s*Fetched/i.test(t)) return "Got current Wise quotes";
  return null;
}

function Intent({ task }: { task: TaskView["task"] }) {
  const i = task.intent;
  return (
    <div className="intent" data-testid="intent">
      <h3>Your settings</h3>
      <ul>
        <li>Goal: <strong>{i.preference === "fastest" ? "fastest route" : i.preference === "cheapest" ? "lowest cost" : "lowest cost (default)"}</strong></li>
        <li>Living reserve: <strong>{formatUsd(i.reserveCents)}</strong></li>
        <li className="muted">Recipient, amount and deadline come from your invoice.</li>
      </ul>
    </div>
  );
}

/** Objective + reserve for ONE plan. Used before planning and for re-planning; both send the same instruction to the same endpoint. */
export function PlanControls({ pref, setPref, reserve, setReserve, balanceCents, defaultReserveCents, disabled }: {
  pref: Preference; setPref: (p: Preference) => void; reserve: string; setReserve: (v: string) => void;
  balanceCents: string | null; defaultReserveCents: string | null; disabled: boolean;
}) {
  const cents = kztToTiyn(reserve);
  const step = (d: bigint) => {
    const cur = BigInt(cents ?? "0") + d;
    const max = balanceCents ? BigInt(balanceCents) : cur;
    const next = cur < 0n ? 0n : cur > max ? max : cur;
    setReserve(tiynToInput(next.toString()) || "0");
  };
  const over = cents !== null && balanceCents !== null && BigInt(cents) > BigInt(balanceCents);
  return (
    <div className="plan-controls" data-testid="plan-controls">
      <div className="stepper-input">
        <label htmlFor="reserve-input" className="small">Living reserve (USD)</label>
        <div className="num-input">
          <button type="button" className="icon-btn" onClick={() => step(-5000n)} aria-label="Keep USD 50 less" disabled={disabled}><Icon name="minus" size={16} /></button>
          <input id="reserve-input" inputMode="decimal" value={reserve} onChange={(e) => setReserve(e.target.value)} aria-invalid={cents === null} aria-describedby="reserve-help" data-testid="reserve-input" disabled={disabled} />
          <button type="button" className="icon-btn" onClick={() => step(5000n)} aria-label="Keep USD 50 more" disabled={disabled}><Icon name="plus" size={16} /></button>
        </div>
        <small id="reserve-help" className={cents === null || over ? "err" : "muted"}>
          {cents === null ? "Enter the amount in USD, for example 300 or 300.50."
            : over ? "More than your funds, so no option can qualify."
            : defaultReserveCents !== null && cents !== defaultReserveCents ? `This plan only. Saved default: ${formatUsd(defaultReserveCents)}.`
            : "Stays untouched."}
        </small>
      </div>
      <div role="radiogroup" aria-label="Route objective" className="seg-toggle">
        {(["cheapest", "fastest"] as Preference[]).map((p) => (
          <button key={p} type="button" role="radio" aria-checked={pref === p} className={pref === p ? "on" : ""} onClick={() => setPref(p)} disabled={disabled} data-testid={`pref-${p}`}>
            <Icon name={p === "cheapest" ? "coins" : "clock"} size={16} /> {p === "cheapest" ? "Lowest cost" : "Fastest route"}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Re-plan an open proposal with another reserve or objective, through the existing cancel + create endpoints. */
function Adjust({ view, balances, onReplan, busy }: { view: TaskView; balances: Balances; onReplan: (p: Preference, reserveCents: string) => void; busy: boolean }) {
  const startPref = (view.proposal?.payload.preference ?? view.task.intent.preference ?? "cheapest") as Preference;
  const startReserve = view.task.intent.reserveCents;
  const [pref, setPref] = useState<Preference>(startPref);
  const [reserve, setReserve] = useState(tiynToInput(startReserve) || "0");
  useEffect(() => { setPref(startPref); setReserve(tiynToInput(startReserve) || "0"); }, [startPref, startReserve, view.task.id]);
  const cents = kztToTiyn(reserve);
  const changed = cents !== null && (pref !== startPref || cents !== startReserve);
  return (
    <div className="adjust" data-testid="adjust">
      <h3>Change the plan</h3>
      <PlanControls pref={pref} setPref={setPref} reserve={reserve} setReserve={setReserve} balanceCents={balances.usd.balanceCents} defaultReserveCents={balances.usd.reserveCents} disabled={busy} />
      <button type="button" className="btn btn-block" disabled={busy || !changed || cents === null} onClick={() => onReplan(pref, cents!)} data-testid="replan">
        <Icon name="retry" size={16} /> Update plan
      </button>
    </div>
  );
}

/** The assistant's own wording, shown only when the server's grounding check accepted it. The figures are the server's. */
function Explanation({ view }: { view: TaskView }) {
  const text = [...view.events].reverse().find((e) => e.kind === "assistant")?.text ?? null;
  if (!text) return null;
  const who = view.task.mode === "MOCK" ? "sandbox stand-in" : "AI assistant";
  return (
    <div className="assistant" data-testid="assistant-explanation">
      <p>{text}</p>
      <p className="muted small">Written by the {who}. Amounts and ranking come from the server.</p>
    </div>
  );
}

function ProblemCard({ problem, busy, onRetry }: { problem: Problem; busy: boolean; onRetry: () => void }) {
  return (
    <div className="problem" role="alert" data-testid="problem" data-kind={problem.kind}>
      <h3><Icon name="alert" size={18} /> {problem.title}</h3>
      <p data-testid="task-error">{problem.reason}</p>
      <div className="actions">
        {problem.actions.includes("retry") && <button type="button" className="btn btn-primary" onClick={onRetry} disabled={busy} data-testid="retry-plan"><Icon name="retry" size={16} /> Try again</button>}
        {problem.actions.includes("manual") && <button type="button" className="btn" onClick={openManualOffer} data-testid="enter-offer">Add an offer from your bank</button>}
      </div>
    </div>
  );
}

function Reason({ icon, title, children }: { icon: IconName; title: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="reason">
      <span className="tile" aria-hidden="true"><Icon name={icon} size={20} /></span>
      <div><strong>{title}</strong><p className="muted small">{children}</p></div>
    </li>
  );
}

function Recommendation({ view, routes, selectedId, nowMs }: { view: TaskView; routes: RouteRow[]; selectedId: string | null; nowMs: number }) {
  const proposal = view.proposal as Proposal;
  const p = proposal.payload;
  const rec = routes.find((r) => r.quoteId === p.quoteId);
  const inspected = routes.find((r) => r.quoteId === selectedId);
  const other = inspected && inspected.quoteId !== p.quoteId ? inspected : null;
  const qualifying = routes.filter((r) => r.feasible).length;
  const free = BigInt(proposal.display.usdAfterCents) - BigInt(p.reserveCents);
  const expired = Date.parse(p.quoteExpiresAt) <= nowMs;
  const others = routes.filter((r) => r.quoteId !== p.quoteId);
  const reserve = formatUsd(p.reserveCents);
  const reason = qualifying > 1
    ? (p.preference === "fastest" ? `Earliest arrival among ${qualifying} options that meet your deadline and keep your ${reserve} reserve.` : `Lowest total among ${qualifying} options that arrive by your deadline and keep your ${reserve} reserve.`)
    : `The only option that arrives by your deadline and keeps your ${reserve} reserve.`;
  return (
    <div className="rec" key={other ? other.quoteId : "rec"}>
      {expired && <p className="alert" role="alert" data-testid="quote-expired"><Icon name="clock" size={18} /> This offer has expired. Plan again for a current price.</p>}
      {other ? (
        <>
          <h3 className="rec-title">{providerShort(other.provider)}</h3>
          <p className="muted">
            {other.feasible ? "This option qualifies, but your plan covers the recommended one." : "This option does not qualify."}{" "}
            {rec?.totalDebitCents && other.totalDebitCents ? `It costs ${diffText(other.totalDebitCents, rec.totalDebitCents)}` : ""}
            {other.estArrivalAt && p.estArrivalAt ? `${rec?.totalDebitCents ? " and arrives " : "It arrives "}${span(Date.parse(other.estArrivalAt) - Date.parse(p.estArrivalAt))} ${Date.parse(other.estArrivalAt) <= Date.parse(p.estArrivalAt) ? "earlier" : "later"}.` : "."}
          </p>
          <ul className="reasons-list">
            <Reason icon="coins" title={`You would pay ${other.totalDebit}`}>Includes a {other.fee} fee; the university receives {other.recipientWillReceive}.</Reason>
            <Reason icon="wallet" title={`${other.usdAfterPayment} left after paying`}>Your living reserve is {reserve}.</Reason>
            {!other.feasible && other.exclusions.map((e, k) => <Reason key={k} icon="alert" title={e.code.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}>{e.message}</Reason>)}
          </ul>
          <p className="hint">To plan with a different goal, change the plan below.</p>
        </>
      ) : (
        <>
          <h3 className="rec-title" data-testid="recommendation">Best option: {providerShort(p.providerName)}</h3>
          <p className="muted" data-testid="recommendation-reason">{reason}</p>
          <ul className="reasons-list">
            <Reason icon="coins" title={`You pay ${formatUsd(p.totalDebitCents)}`}>Includes a {formatUsd(p.feeCents)} fee. The university receives {formatKzt(p.recipientTiyn)}.</Reason>
            <Reason icon="calendar" title={`Arrives about ${fmtTime(p.estArrivalAt)}`}>{arrivalLine(p.estArrivalAt, p.deadlineAt).replace(/^Arrives about [^·]*· /, "")}. An estimate.</Reason>
            <Reason icon="wallet" title={`${formatUsd(proposal.display.usdAfterCents)} left after paying`}>Your {reserve} reserve stays untouched; {formatUsd(free < 0n ? "0" : free.toString())} is free to use.</Reason>
          </ul>
          <details className="why" data-testid="why-details">
            <summary>Why this option</summary>
            <Explanation view={view} />
            {others.length > 0 && (
              <ul className="why-list">
                {others.map((r) => (
                  <li key={r.quoteId}>
                    <strong>{providerShort(r.provider)}</strong>:{" "}
                    {r.feasible
                      ? `qualifies but ${rec?.totalDebitCents && r.totalDebitCents ? `costs ${diffText(r.totalDebitCents, rec.totalDebitCents)}` : "is not the best fit"} (${arrivalLine(r.estArrivalAt).toLowerCase()}).`
                      : r.exclusions.map((e) => e.message).join(" ")}
                  </li>
                ))}
              </ul>
            )}
            <p className="muted small">{sourceDetail(p.quoteProvenance, p.quoteSourceNote, p.quoteObservedAt)}. Valid until {fmtTime(p.quoteExpiresAt)}.</p>
          </details>
        </>
      )}
    </div>
  );
}

export interface PlanInputs {
  pref: Preference; setPref: (p: Preference) => void;
  reserve: string; setReserve: (v: string) => void;
  ownWords: string; setOwnWords: (v: string) => void; ownOpen: boolean; setOwnOpen: (v: boolean) => void;
  /** The reserve the server will apply to a plan started now (preview), and the saved default it falls back to. */
  previewReserveCents: string | null; unclearText: boolean;
}

/** What the user needs to know once a plan is not waiting for a decision: built from stored records, never from model prose. */
function StateNote({ view, routes, live }: { view: TaskView; routes: RouteRow[]; live: boolean }) {
  const state = view.task.state;
  if (state === "APPROVED") return <p className="agent-says" data-testid="agent-summary">Your payment instruction is ready. Follow it to complete the payment.</p>;
  if (state === "COMPLETED") return <p className="agent-says" data-testid="agent-summary">Completed in the sandbox ledger (simulated).</p>;
  if (state === "BLOCKED" && !view.task.error) {
    const rejected = routes.filter((r) => !r.feasible);
    return (
      <div className="agent-says" data-testid="agent-summary">
        <strong>No option qualifies right now.</strong>
        {rejected.length > 0
          ? <ul className="why-list">{rejected.map((r) => <li key={r.quoteId}><strong>{providerShort(r.provider)}</strong>: {r.exclusions.map((e) => e.message).join(" ")}</li>)}</ul>
          : view.task.summary ? <span> {view.task.summary}</span> : null}
        {live && <p className="muted small">Change your reserve or add another offer, then plan again.</p>}
      </div>
    );
  }
  return null;
}

export interface PlanInputs {
  pref: Preference; setPref: (p: Preference) => void;
  reserve: string; setReserve: (v: string) => void;
  ownWords: string; setOwnWords: (v: string) => void; ownOpen: boolean; setOwnOpen: (v: boolean) => void;
  /** The reserve the server will apply to a plan started now (preview), and the saved default it falls back to. */
  previewReserveCents: string | null; unclearText: boolean;
}

export function PlannerPanel({ config, live, invoice, view, offerCount, nowMs, starting, taskIsActive, routes, selectedId, balances, inputs, onStart, onReplan }: {
  config: Config | null; live: boolean; invoice: Invoice | null; view: TaskView | null; offerCount: number; nowMs: number;
  starting: boolean; taskIsActive: boolean; routes: RouteRow[]; best: string | null; selectedId: string | null; balances: Balances | null; inputs: PlanInputs;
  onStart: () => void; onReplan: (p: Preference, reserveCents: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const state = view?.task.state;
  const st = state ? STATE_TEXT[state] : null;
  const notConfigured = config?.agentStatus === "NOT_CONFIGURED";
  const confirmed = invoice?.status === "CONFIRMED";
  const closed = invoice?.status === "PAID" || invoice?.status === "INSTRUCTED";
  // Planning fetches Wise by itself; only a setup with Wise switched off AND no offer at all has nothing to plan with.
  const noSource = live && !config?.wiseQuotes && offerCount === 0;
  // Own words are always sent as written: the server reads them and gives the precise refusal if they are unclear or conflicting.
  const reserveOk = inputs.ownOpen && inputs.ownWords.trim() ? true : kztToTiyn(inputs.reserve) !== null;
  const canPlan = confirmed && !taskIsActive && !notConfigured && !noSource && reserveOk;
  const chip = notConfigured ? "Setup required" : config?.agentStatus === "MOCK" ? "MOCK (sandbox)" : null;
  async function replan(p: Preference, cents: string) { setBusy(true); try { await onReplan(p, cents); } finally { setBusy(false); } }

  const events = view?.events ?? [];
  const done = events.filter((e) => e.kind === "tool" && e.ok).map((e) => TOOL_PHRASE[e.tool ?? ""]).filter(Boolean);
  const infoSteps = events.filter((e) => e.kind === "info").map((e) => stepFromInfo(e.text ?? "")).filter(Boolean) as string[];
  const showRec = state === "AWAITING_APPROVAL" && view?.proposal && routes.length > 0;
  const problem = diagnose(view);
  const formShown = !state || (state !== "RUNNING" && state !== "AWAITING_APPROVAL" && state !== "EXECUTING");
  const applied = inputs.previewReserveCents;
  const defaultCents = balances?.usd.reserveCents ?? null;
  const ownText = inputs.ownOpen && inputs.ownWords.trim().length > 0;

  return (
    <aside className="planner" aria-labelledby="planner-h" data-testid="planner">
      <header className="planner-head">
        <span className="tile tile-accent" aria-hidden="true"><Icon name="spark" size={20} /></span>
        <h2 id="planner-h">Your plan</h2>
        {chip && <Chip tone={notConfigured ? "bad" : "muted"}>{chip}</Chip>}
      </header>
      <div aria-live="polite" className="planner-body">
        {st && <p className="planner-state"><Chip tone={st.tone}><span data-testid="task-state">{st.text}</span></Chip></p>}

        {notConfigured && (
          <div className="notice notice-bad" role="alert">
            <Icon name="alert" size={18} /> <div><strong>Setup required.</strong> Add an AI model in <code>.env</code> and restart.</div>
          </div>
        )}

        {state === "RUNNING" && (
          <div className="loading" role="status" data-testid="planner-loading">
            <h3>Comparing your options…</h3>
            <ul className="steps-live">
              {live && infoSteps.length === 0 && <li className="now"><span className="pulse" aria-hidden="true" /> Getting current Wise quotes</li>}
              {infoSteps.map((t, i) => <li key={`i${i}`} className="done"><Icon name="check" size={16} /> {t}</li>)}
              {done.map((t, i) => <li key={`d${i}`} className="done"><Icon name="check" size={16} /> {t}</li>)}
              {(!live || infoSteps.length > 0) && <li className="now"><span className="pulse" aria-hidden="true" /> Working…</li>}
            </ul>
            <div className="skeleton" aria-hidden="true"><span /><span /><span /></div>
          </div>
        )}

        {view && state !== "RUNNING" && <StateNote view={view} routes={routes} live={live} />}
        {problem && <ProblemCard problem={problem} busy={starting || busy || taskIsActive} onRetry={onStart} />}

        {showRec && <Recommendation view={view!} routes={routes} selectedId={selectedId} nowMs={nowMs} />}
        {state === "AWAITING_APPROVAL" && balances && view && <Adjust view={view} balances={balances} onReplan={replan} busy={busy || starting} />}
        {view && <Intent task={view.task} />}

        {formShown && (
          <div className="plan-form">
            {closed && state !== "APPROVED" && <p className="muted" data-testid="planner-closed"><Icon name="info" size={16} /> {invoice?.status === "INSTRUCTED" ? "Your payment instruction is ready. There is nothing more to plan for this invoice." : "This invoice is already paid (simulated)."}</p>}
            {!confirmed && !closed && !notConfigured && <p className="muted"><Icon name="info" size={16} /> {invoice ? "Confirm the invoice to plan." : "Add and confirm an invoice to plan."}</p>}
            {confirmed && noSource && <p className="muted" data-testid="planner-no-offers"><Icon name="info" size={16} /> There are no payment options yet: Wise quotes are off in this setup, so add an offer from your bank first.</p>}
            {confirmed && !closed && (
              <>
                <PlanControls pref={inputs.pref} setPref={inputs.setPref} reserve={inputs.reserve} setReserve={inputs.setReserve} balanceCents={balances?.usd.balanceCents ?? null} defaultReserveCents={defaultCents} disabled={taskIsActive || ownText} />
                <p className="reserve-applied" data-testid="reserve-applied">
                  Reserve for this plan: <strong className="num">{applied !== null ? formatUsd(applied) : "not set"}</strong>
                  {ownText ? (inputs.unclearText ? " (unclear in your own words)" : " (from your own words)") : ""}
                </p>
              </>
            )}
            {!closed && <details className="own-words" open={inputs.ownOpen} onToggle={(e) => inputs.setOwnOpen((e.target as HTMLDetailsElement).open)}>
              <summary data-testid="own-words">Write your own request (optional)</summary>
              <label className="field" htmlFor="instruction-input">
                <span>What should we do? (English or Russian)</span>
                <textarea id="instruction-input" value={inputs.ownWords} onChange={(e) => inputs.setOwnWords(e.target.value)} rows={3} maxLength={500} data-testid="instruction" disabled={taskIsActive} />
              </label>
              <div className="chips">
                {EXAMPLES.map((ex, i) => (<button key={i} type="button" className="chip-btn" onClick={() => inputs.setOwnWords(ex)} disabled={taskIsActive}>Example {i + 1}</button>))}
              </div>
              <p className="hint">This replaces the settings above.</p>
            </details>}
            <div className="actions">
              <button className="btn btn-primary btn-lg" onClick={onStart} disabled={starting || !canPlan} hidden={closed} data-testid="start-task"><Icon name="spark" size={16} /> Plan my payment</button>
              {invoice?.status !== "CONFIRMED" && invoice?.status !== "PAID" && invoice?.status !== "INSTRUCTED" && invoice && <span className="muted small">Confirm the invoice first.</span>}
              {notConfigured && <span className="muted small">Planning is off until a model is set up.</span>}
              {confirmed && !noSource && live && !closed && <span className="muted small">Gets current Wise quotes and compares them.</span>}
            </div>
          </div>
        )}
        {state === "EXECUTING" && <p role="status" className="muted"><span className="pulse" aria-hidden="true" /> Recording your approved payment in the sandbox ledger…</p>}
      </div>
    </aside>
  );
}

/** Sticky bar while a proposal waits: what stays free, the human-approval promise, and the way to the review card. */
export function ReviewBar({ proposal, nowMs, onReview }: { proposal: Proposal; nowMs: number; onReview: () => void }) {
  const free = BigInt(proposal.display.usdAfterCents) - BigInt(proposal.payload.reserveCents);
  const expired = Date.parse(proposal.payload.quoteExpiresAt) <= nowMs;
  return (
    <div className="review-bar" role="region" aria-label="Review summary" data-testid="review-bar">
      <div className="rb-free"><strong className="num">{formatUsd(free < 0n ? "0" : free.toString())}</strong><span className="muted small">free after paying and your reserve</span></div>
      <div className="rb-lock muted small"><Icon name="lock" size={18} /> Nothing happens until you approve</div>
      <button type="button" className="btn btn-primary btn-lg" onClick={onReview} disabled={expired} data-testid="review-payment">{expired ? "Offer expired" : "Review and approve"} <Icon name="arrowRight" size={18} /></button>
    </div>
  );
}

export { buildInstruction };
