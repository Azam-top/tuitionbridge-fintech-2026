import { useEffect, useState } from "react";
import type { Balances, Config, Invoice, Proposal, RouteRow, TaskView } from "./api";
import { Chip } from "./components";
import { diagnose, type Problem } from "./problems";
import { fmtTime, formatKzt, formatUsd, kztToTiyn, tiynToInput } from "./format";
import { Icon, type IconName } from "./icons";
import { openManualOffer, PROVENANCE_LABEL } from "./LivePanels";
import { arrivalLine, buildInstruction, diffText, span, type Preference } from "./plan";
import { Reveal } from "./Routes";

export const EXAMPLES = [
  "Pay this invoice by its deadline, use the cheapest feasible route, and keep USD 300 for living costs.",
  "Pay this invoice by its deadline, prefer faster arrival, and keep USD 300 for living costs.",
  "Оплати счёт до срока, выбери самый дешёвый вариант и оставь 300 долларов на жизнь.",
];

const STATE_TEXT: Record<string, { tone: "ok" | "warn" | "bad" | "info" | "muted"; text: string }> = {
  RUNNING: { tone: "info", text: "Agent is working" },
  AWAITING_APPROVAL: { tone: "warn", text: "Waiting for your approval" },
  EXECUTING: { tone: "info", text: "Executing after your approval" },
  APPROVED: { tone: "ok", text: "Approved: instruction issued" },
  COMPLETED: { tone: "ok", text: "Completed (simulated)" },
  BLOCKED: { tone: "bad", text: "Blocked: nothing was paid" },
  FAILED: { tone: "bad", text: "Failed: nothing was paid unless a receipt is shown" },
  CANCELLED: { tone: "muted", text: "Cancelled" },
};

const TOOL_PHRASE: Record<string, string> = {
  parse_invoice: "Read your confirmed invoice", get_balances: "Checked your declared funds", get_quotes: "Collected the current offers",
  evaluate_routes: "Ranked the routes", prepare_payment: "Prepared the proposal", execute_sandbox_payment: "Recorded the sandbox payment",
};

function Intent({ task }: { task: TaskView["task"] }) {
  const i = task.intent;
  return (
    <div className="intent" data-testid="intent">
      <h3>What the agent understood from you</h3>
      <ul>
        <li>Route preference: <strong>{i.preference ?? "not stated (the agent may choose; defaults to cheapest feasible)"}</strong>{i.preferenceSource ? ` (${i.preferenceSource})` : ""}</li>
        <li>Keep for living costs: <strong>{formatUsd(i.reserveCents)}</strong> ({i.reserveSource === "instruction" ? "chosen for this plan" : "your saved default"}). The agent cannot lower this.</li>
        <li>Deadline, amount and beneficiary: taken from the invoice you confirmed. The agent cannot change them.</li>
        <li className="muted">Your words: “{task.instruction}”</li>
      </ul>
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
        <label htmlFor="reserve-input" className="small">Keep for living costs (USD)</label>
        <div className="num-input">
          <button type="button" className="icon-btn" onClick={() => step(-5000n)} aria-label="Keep USD 50 less" disabled={disabled}><Icon name="minus" size={16} /></button>
          <input id="reserve-input" inputMode="decimal" value={reserve} onChange={(e) => setReserve(e.target.value)} aria-invalid={cents === null} aria-describedby="reserve-help" data-testid="reserve-input" disabled={disabled} />
          <button type="button" className="icon-btn" onClick={() => step(5000n)} aria-label="Keep USD 50 more" disabled={disabled}><Icon name="plus" size={16} /></button>
        </div>
        <small id="reserve-help" className={cents === null || over ? "err" : "muted"}>
          {cents === null ? "Enter the amount in USD, for example 300 or 300.50."
            : over ? "This is more than the USD you declared, so no route can qualify."
            : defaultReserveCents !== null && cents !== defaultReserveCents ? `This plan only. Your saved default is ${formatUsd(defaultReserveCents)}.`
            : "This amount stays untouched. It is your saved default."}
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
      <h3>Adjust the plan</h3>
      <PlanControls pref={pref} setPref={setPref} reserve={reserve} setReserve={setReserve} balanceCents={balances.usd.balanceCents} defaultReserveCents={balances.usd.reserveCents} disabled={busy} />
      <button type="button" className="btn btn-block" disabled={busy || !changed || cents === null} onClick={() => onReplan(pref, cents!)} data-testid="replan">
        <Icon name="retry" size={16} /> Re-plan with these settings
      </button>
      <p className="hint">Re-planning cancels this proposal and asks the assistant again through the same checks. Nothing is paid.</p>
    </div>
  );
}

/** The assistant's own wording, shown only when the server's grounding check accepted it. The figures above it are the server's. */
function AssistantNote({ view }: { view: TaskView }) {
  const text = [...view.events].reverse().find((e) => e.kind === "assistant")?.text ?? null;
  const withheld = view.events.some((e) => e.kind === "assistant_withheld");
  const unavailable = view.events.some((e) => e.kind === "explanation_unavailable");
  const who = view.task.mode === "MOCK" ? "MOCK assistant (sandbox)" : "AI assistant";
  if (!text && !withheld && !unavailable) return null;
  return (
    <div className="assistant" data-testid="assistant-explanation">
      <h3><Icon name="spark" size={16} /> Explained by the {who}</h3>
      {text ? <p>{text}</p> : <p className="muted">{unavailable ? "The assistant could not finish its explanation." : "The assistant's wording was withheld because it did not match the stored records."} The figures and reasons above come straight from the server.</p>}
      <p className="hint">The server, not the assistant, ranked the routes and checked every amount{text ? "; the assistant's text is shown only when its numbers match the stored records" : ""}.</p>
    </div>
  );
}

function ProblemCard({ problem, busy, onRetry }: { problem: Problem; busy: boolean; onRetry: () => void }) {
  return (
    <div className="problem" role="alert" data-testid="problem" data-kind={problem.kind}>
      <h3><Icon name="alert" size={18} /> {problem.title}</h3>
      <p data-testid="task-error">{problem.reason}</p>
      <p className="muted small">Nothing was paid.</p>
      <div className="actions">
        {problem.actions.includes("retry") && <button type="button" className="btn btn-primary" onClick={onRetry} disabled={busy} data-testid="retry-plan"><Icon name="retry" size={16} /> Try again</button>}
        {problem.actions.includes("manual") && <button type="button" className="btn" onClick={openManualOffer} data-testid="enter-offer">Enter an offer from your bank</button>}
      </div>
    </div>
  );
}

function Recommendation({ view, routes, best, selectedId, nowMs }: { view: TaskView; routes: RouteRow[]; best: string | null; selectedId: string | null; nowMs: number }) {
  const [whyOpen, setWhyOpen] = useState(false);
  const proposal = view.proposal as Proposal;
  const p = proposal.payload;
  const rec = routes.find((r) => r.quoteId === p.quoteId);
  const inspected = routes.find((r) => r.quoteId === selectedId);
  const other = inspected && inspected.quoteId !== p.quoteId ? inspected : null;
  const qualifying = routes.filter((r) => r.feasible).length;
  const free = BigInt(proposal.display.usdAfterCents) - BigInt(p.reserveCents);
  const expired = Date.parse(p.quoteExpiresAt) <= nowMs;
  const others = routes.filter((r) => r.quoteId !== p.quoteId);
  void best;
  return (
    <div className="rec" key={other ? other.quoteId : "rec"}>
      {expired && <p className="alert" role="alert" data-testid="quote-expired"><Icon name="clock" size={18} /> This quote has expired. Plan again for fresh numbers; an expired quote cannot be approved.</p>}
      {other ? (
        <>
          <h3 className="rec-title">{other.provider.replace(" (simulated)", "")}</h3>
          <p className="muted">
            {other.feasible ? "This option qualifies, but your proposal covers the recommended route." : "This option does not qualify."}{" "}
            {rec?.totalDebitCents && other.totalDebitCents ? `It costs ${diffText(other.totalDebitCents, rec.totalDebitCents)} to pay` : ""}
            {other.estArrivalAt && p.estArrivalAt ? `${rec?.totalDebitCents ? " and arrives " : "It arrives "}${span(Date.parse(other.estArrivalAt) - Date.parse(p.estArrivalAt))} ${Date.parse(other.estArrivalAt) <= Date.parse(p.estArrivalAt) ? "earlier" : "later"} than the recommended one.` : "."}
          </p>
          <ul className="reasons-list">
            <Reason icon="coins" title={`You would pay ${other.totalDebit}`}>Includes a {other.fee} fee; the university receives {other.recipientWillReceive}.</Reason>
            <Reason icon="wallet" title={`${other.usdAfterPayment} left after paying`}>Compared with your protected reserve of {formatUsd(p.reserveCents)}.</Reason>
            {!other.feasible && other.exclusions.map((e, k) => <Reason key={k} icon="alert" title={e.code.replace(/_/g, " ")}>{e.message}</Reason>)}
          </ul>
          <p className="hint">To approve a different objective, adjust the plan below and re-plan.</p>
        </>
      ) : (
        <>
          <h3 className="rec-title" data-testid="recommendation">Recommended: {p.providerName.replace(" (simulated)", "")}</h3>
          <p className="muted">
            Chosen by the server from {qualifying} qualifying of {routes.length} {routes.length === 1 ? "option" : "options"}: the {p.preference === "fastest" ? "fastest" : "lowest-cost"} route that arrives by your deadline and keeps your reserve.
          </p>
          <ul className="reasons-list">
            <Reason icon="coins" title={`You pay ${formatUsd(p.totalDebitCents)} in total`}>Includes a {formatUsd(p.feeCents)} fee. The university should receive {formatKzt(p.recipientTiyn)} of the {formatKzt(p.tuitionTiyn)} due.</Reason>
            <Reason icon="calendar" title={`Arrives about ${fmtTime(p.estArrivalAt)}`}>{arrivalLine(p.estArrivalAt, p.deadlineAt).replace(/^Arrives about [^·]*· /, "")}. This is an estimate, not a guarantee.</Reason>
            <Reason icon="wallet" title={`${formatUsd(proposal.display.usdAfterCents)} left after paying`}>Your protected {formatUsd(p.reserveCents)} stays untouched; {formatUsd(free < 0n ? "0" : free.toString())} is free to use.</Reason>
            <Reason icon="shield" title={PROVENANCE_LABEL[p.quoteProvenance] ?? p.quoteProvenance}>{p.quoteObservedAt ? `Seen ${fmtTime(p.quoteObservedAt)}. ` : "Observation time unknown. "}{p.quoteSourceNote ?? ""} Valid until {fmtTime(p.quoteExpiresAt)}.</Reason>
          </ul>
          {others.length > 0 && (
            <div className="why">
              <button type="button" className="link-btn" aria-expanded={whyOpen} aria-controls="why-others" onClick={() => setWhyOpen(!whyOpen)}>
                <Icon name="info" size={16} /> Why not the {others.length === 1 ? "other option" : `other ${others.length} options`}?
              </button>
              <Reveal open={whyOpen} id="why-others">
                <ul className="why-list">
                  {others.map((r) => (
                    <li key={r.quoteId}>
                      <strong>{r.provider.replace(" (simulated)", "")}</strong>:{" "}
                      {r.feasible
                        ? `qualifies but ${rec?.totalDebitCents && r.totalDebitCents ? `costs ${diffText(r.totalDebitCents, rec.totalDebitCents)}` : "is not the best fit"}${p.preference === "fastest" ? "" : ""} (${arrivalLine(r.estArrivalAt).toLowerCase()}).`
                        : r.exclusions.map((e) => e.message).join(" ")}
                    </li>
                  ))}
                </ul>
              </Reveal>
            </div>
          )}
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

export function PlannerPanel({ config, live, invoice, view, offerCount, nowMs, starting, taskIsActive, routes, best, selectedId, balances, inputs, onStart, onReplan }: {
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
  const infos = events.filter((e) => e.kind === "info").map((e) => e.text).filter(Boolean) as string[];
  const showRec = state === "AWAITING_APPROVAL" && view?.proposal && routes.length > 0;
  const problem = diagnose(view);
  const formShown = !state || (state !== "RUNNING" && state !== "AWAITING_APPROVAL" && state !== "EXECUTING");
  const applied = inputs.previewReserveCents;
  const defaultCents = balances?.usd.reserveCents ?? null;

  return (
    <aside className="planner" aria-labelledby="planner-h" data-testid="planner">
      <header className="planner-head">
        <span className="tile tile-accent" aria-hidden="true"><Icon name="spark" size={20} /></span>
        <h2 id="planner-h">Transfer planner</h2>
        {chip && <Chip tone={notConfigured ? "bad" : "muted"}>{chip}</Chip>}
      </header>
      <div aria-live="polite" className="planner-body">
        {st && <p className="planner-state"><Chip tone={st.tone}><span data-testid="task-state">{st.text}</span></Chip></p>}

        {notConfigured && (
          <div className="notice notice-bad" role="alert">
            <Icon name="alert" size={18} /> <div><strong>Setup required.</strong> The planner needs an AI model; the live mode has no stand-in. See the setup notice above.</div>
          </div>
        )}

        {state === "RUNNING" && (
          <div className="loading" role="status" data-testid="planner-loading">
            <h3>Comparing your options…</h3>
            <ul className="steps-live">
              {live && infos.length === 0 && <li className="now"><span className="pulse" aria-hidden="true" /> Asking Wise and the National Bank for current numbers</li>}
              {infos.map((t, i) => <li key={`i${i}`} className="done"><Icon name="check" size={16} /> {t}</li>)}
              {done.map((t, i) => <li key={`d${i}`} className="done"><Icon name="check" size={16} /> {t}</li>)}
              {(!live || infos.length > 0) && <li className="now"><span className="pulse" aria-hidden="true" /> Working on the next step</li>}
            </ul>
            <div className="skeleton" aria-hidden="true"><span /><span /><span /></div>
          </div>
        )}

        {view?.task.summary && state !== "RUNNING" && <p className="agent-says" data-testid="agent-summary"><strong>Summary:</strong> {view.task.summary}</p>}
        {problem && <ProblemCard problem={problem} busy={starting || busy || taskIsActive} onRetry={onStart} />}

        {showRec && <Recommendation view={view!} routes={routes} best={best} selectedId={selectedId} nowMs={nowMs} />}
        {showRec && <AssistantNote view={view!} />}
        {state === "AWAITING_APPROVAL" && balances && view && <Adjust view={view} balances={balances} onReplan={replan} busy={busy || starting} />}
        {view && <Intent task={view.task} />}

        {formShown && (
          <div className="plan-form">
            {closed && <p className="muted" data-testid="planner-closed"><Icon name="info" size={16} /> {invoice?.status === "INSTRUCTED" ? "A payment instruction was issued for this invoice. Follow it outside the app; nothing more to plan." : "This invoice is already paid (simulated). Nothing more to plan."}</p>}
            {!confirmed && !closed && !notConfigured && <p className="muted"><Icon name="info" size={16} /> {invoice ? "Confirm the invoice to plan." : "Add and confirm an invoice to plan."}</p>}
            {confirmed && noSource && <p className="muted" data-testid="planner-no-offers"><Icon name="info" size={16} /> There are no payment options yet: live Wise quotes are switched off in this setup, so add an offer from your bank below. The planner never invents one.</p>}
            {confirmed && !closed && (
              <>
                <PlanControls pref={inputs.pref} setPref={inputs.setPref} reserve={inputs.reserve} setReserve={inputs.setReserve} balanceCents={balances?.usd.balanceCents ?? null} defaultReserveCents={defaultCents} disabled={taskIsActive || inputs.ownOpen && inputs.ownWords.trim().length > 0} />
                <p className="reserve-applied" data-testid="reserve-applied">
                  Reserve applied to this plan: <strong className="num">{applied !== null ? formatUsd(applied) : "not set"}</strong>
                  {inputs.ownOpen && inputs.ownWords.trim() ? (inputs.unclearText ? " (your own words are unclear about it)" : " (read from your own words)") : ""}
                </p>
              </>
            )}
            {!closed && <details className="own-words" open={inputs.ownOpen} onToggle={(e) => inputs.setOwnOpen((e.target as HTMLDetailsElement).open)}>
              <summary data-testid="own-words">Use your own words instead (optional)</summary>
              <label className="field" htmlFor="instruction-input">
                <span>What should the assistant do? (English; a Russian example is included)</span>
                <textarea id="instruction-input" value={inputs.ownWords} onChange={(e) => inputs.setOwnWords(e.target.value)} rows={3} maxLength={500} data-testid="instruction" disabled={taskIsActive} />
              </label>
              <div className="chips">
                {EXAMPLES.map((ex, i) => (<button key={i} type="button" className="chip-btn" onClick={() => inputs.setOwnWords(ex)} disabled={taskIsActive}>Example {i + 1}</button>))}
              </div>
              <p className="hint">If you write something here it replaces the settings above. The server reads the preference and reserve from it and refuses unclear or conflicting instructions.</p>
            </details>}
            <div className="actions">
              <button className="btn btn-primary btn-lg" onClick={onStart} disabled={starting || !canPlan} data-testid="start-task"><Icon name="spark" size={16} /> Plan my payment</button>
              {invoice?.status !== "CONFIRMED" && invoice?.status !== "PAID" && invoice?.status !== "INSTRUCTED" && invoice && <span className="muted small">Confirm the invoice first.</span>}
              {(invoice?.status === "PAID" || invoice?.status === "INSTRUCTED") && <span className="muted small">{invoice.status === "PAID" ? "This invoice is already paid." : "A payment instruction was already issued for this invoice."}</span>}
              {notConfigured && <span className="muted small">Planning is disabled until a model is configured.</span>}
              {confirmed && !noSource && live && <span className="muted small">Asks Wise for current quotes, then compares them.</span>}
            </div>
            <p className="hint">The assistant can read, compare and prepare. It cannot approve or lower your reserve; {live ? "after you approve, the app issues a payment instruction and moves no money." : "money moves only after you approve."}</p>
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
      <div className="rb-free"><strong className="num">{formatUsd(free < 0n ? "0" : free.toString())}</strong><span className="muted small">free after payment and reserve</span></div>
      <div className="rb-lock muted small"><Icon name="lock" size={18} /> You approve every payment</div>
      <button type="button" className="btn btn-primary btn-lg" onClick={onReview} disabled={expired} data-testid="review-payment">Review payment <Icon name="arrowRight" size={18} /></button>
    </div>
  );
}

export { buildInstruction };
