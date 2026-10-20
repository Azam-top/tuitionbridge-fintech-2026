import { useEffect, useRef, useState } from "react";
import { explain } from "./friendly";
import { api, ApiFailure, type Balances, type Proposal, type Receipt, type RouteRow, type TaskView } from "./api";
import { Card, Chip, Details, Row } from "./components";
import { Icon } from "./icons";
import { ProtectedBudget, RoutePicker } from "./Routes";
import { InstructionCard } from "./LivePanels";
import { providerParts, sourceDetail } from "./plan";
import { fmtRelative, fmtTime, formatKzt, formatUsd } from "./format";

/** Everything that follows the plan in the main column: routes, budget, review card, instruction/receipt, technical details. */
export function TaskPanel({ view, live, now, nowMs, approvalMinutes, limits, routes, best, selectedId, onSelect, balances, onChanged, onError }: {
  view: TaskView; live: boolean; now: string; nowMs: number; approvalMinutes: number; limits: { maxToolCalls: number; maxModelRequests: number };
  routes: RouteRow[]; best: string | null; selectedId: string | null; onSelect: (id: string) => void; balances: Balances | null; onChanged: () => void; onError: (m: string) => void;
}) {
  const { task, events, proposal, receipt, instruction } = view;
  const selected = routes.find((r) => r.quoteId === selectedId) ?? routes.find((r) => r.quoteId === best) ?? null;
  const reserveCents = proposal?.payload.reserveCents ?? task.intent.reserveCents;
  return (
    <div className="stack" data-testid="task-panel" data-task-state={task.state}>
      {receipt && <ReceiptCard receipt={receipt} />}
      {instruction && <InstructionCard instruction={instruction} nowMs={nowMs} onChanged={onChanged} onError={onError} />}
      {routes.length > 0 && <RoutePicker routes={routes} best={best} proposal={proposal} nowMs={nowMs} now={now} live={live} selectedId={selectedId} onSelect={onSelect} />}
      {routes.length > 0 && balances && (
        <ProtectedBudget
          balanceCents={proposal?.display.usdBalanceBeforeCents ?? balances.usd.balanceCents}
          totalCents={selected?.totalDebitCents ?? proposal?.payload.totalDebitCents ?? "0"}
          reserveCents={reserveCents}
        />
      )}
      {task.state === "AWAITING_APPROVAL" && proposal && <ApprovalCard taskId={task.id} proposal={proposal} live={live} now={now} nowMs={nowMs} approvalMinutes={approvalMinutes} onChanged={onChanged} onError={onError} />}

      <details className="card tech" data-testid="tech-panel">
        <summary>Technical details</summary>
        <p className="muted small">
          Assistant: <strong>{task.mode}</strong>{task.model ? ` (${task.model})` : ""}; payments: <strong>{live ? "not moved by the app" : "simulated"}</strong>.
          {task.mode === "MOCK" && " This run used the deterministic sandbox stand-in, not a live model."}
        </p>
        <Usage task={task} limits={limits} />
        <Timeline events={events} />
      </details>
    </div>
  );
}

function Usage({ task, limits }: { task: TaskView["task"]; limits: { maxToolCalls: number; maxModelRequests: number } }) {
  const u = task.usage;
  return (
    <p className="muted small" data-testid="usage">
      Tool calls {u.toolCalls}/{limits.maxToolCalls} · model requests {u.modelRequests}/{limits.maxModelRequests}{u.retries ? ` · retries ${u.retries}` : ""} · latency {u.latencyMs} ms ·{" "}
      {u.tokensKnown ? `tokens ${u.inputTokens} in / ${u.outputTokens} out` : "token usage not reported by this run"}
    </p>
  );
}

function ApprovalCard({ taskId, proposal, live, now, nowMs, approvalMinutes, onChanged, onError }: { taskId: string; proposal: Proposal; live: boolean; now: string; nowMs: number; approvalMinutes: number; onChanged: () => void; onError: (m: string) => void }) {
  const p = proposal.payload;
  const expired = Date.parse(p.quoteExpiresAt) <= nowMs;
  const clicked = useRef(false); // synchronous double-click guard; the server remains authoritative
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLDivElement>(null);
  useEffect(() => { heading.current?.focus(); }, []); // move keyboard/screen-reader focus to the decision

  async function approve() {
    if (clicked.current) return;
    clicked.current = true;
    setBusy(true);
    try {
      await api("POST", `/api/tasks/${taskId}/approve`, { proposalHash: proposal.hash });
      onChanged();
    } catch (e) {
      clicked.current = false;
      onError(explain(e, "Approval failed."));
      onChanged();
    } finally { setBusy(false); }
  }
  async function reject() {
    setBusy(true);
    try { await api("POST", `/api/tasks/${taskId}/cancel`); onChanged(); }
    catch (e) { onError(explain(e, "Could not cancel.")); } finally { setBusy(false); }
  }

  return (
    <Card id="approval" title="Review and approve" aside={<Chip tone={expired ? "bad" : "warn"}>{expired ? "Offer expired" : "Not paid yet"}</Chip>} className="enter">
      <div ref={heading} tabIndex={-1} className="focus-target" aria-label="Approval required: review the details below" />
      {expired && <p className="alert" role="alert" data-testid="approval-expired"><Icon name="clock" size={18} /> This offer has expired, so it cannot be approved. Plan again for a current price.</p>}
      <div className="approval-grid" data-testid="approval-card">
        <section className="sect" aria-labelledby="ap-rec">
          <h3 id="ap-rec">Recipient</h3>
          <dl className="rows">
            <Row label="Name">{p.beneficiaryName}</Row>
            <Row label="Account"><code data-testid="approval-account">{p.beneficiaryAccount}</code></Row>
            <Row label="Invoice">{p.invoiceReference}</Row>
            {!live && p.recipientRegistryId && <Row label="Registry ID">{p.recipientRegistryId}</Row>}
          </dl>
        </section>
        <section className="sect" aria-labelledby="ap-amt">
          <h3 id="ap-amt">Amounts</h3>
          <dl className="rows">
            <Row label="University will receive" strong testId="will-receive"><span className="num">{formatKzt(p.recipientTiyn)}</span>{p.surplusTiyn !== "0" && <small className="muted"> (incl. {formatKzt(p.surplusTiyn)} rounding)</small>}</Row>
            <Row label="Invoice amount"><span className="num">{formatKzt(p.tuitionTiyn)}</span></Row>
            <Row label="You pay" strong testId="will-debit"><span className="num">{formatUsd(p.totalDebitCents)}</span> <small className="muted">incl. {formatUsd(p.feeCents)} fee</small></Row>
            <Row label="Left after payment"><span className="num">{formatUsd(proposal.display.usdAfterCents)}</span></Row>
            <Row label="Living reserve"><span className="num">{formatUsd(p.reserveCents)}</span></Row>
          </dl>
        </section>
        <section className="sect" aria-labelledby="ap-time">
          <h3 id="ap-time">Timing</h3>
          <dl className="rows">
            <Row label="Invoice deadline" testId="deadline">{fmtTime(p.deadlineAt)}</Row>
            <Row label="Expected arrival">{fmtTime(p.estArrivalAt)}</Row>
            <Row label="Offer valid until" testId="quote-expiry">{fmtTime(p.quoteExpiresAt)} {!expired && <small className="muted">({fmtRelative(p.quoteExpiresAt, now)})</small>}</Row>
            <Row label="Approval window" testId="approval-expiry">{approvalMinutes} min after you approve, never beyond the offer</Row>
          </dl>
        </section>
      </div>
      <p className="hint">Approving locks exactly these figures. Only you can approve.</p>
      <div className="actions">
        <button className="btn btn-primary btn-lg" onClick={approve} disabled={busy || expired} data-testid="approve-btn">{live ? "Approve and get instructions" : "Approve and pay (simulated)"}</button>
        <button className="btn btn-lg" onClick={reject} disabled={busy} data-testid="reject-btn">Reject</button>
      </div>
      <details className="inline-details" data-testid="approval-details">
        <summary>Details</summary>
        <dl className="rows">
          <Row label="Route">{providerParts(p.providerName).title}{providerParts(p.providerName).method ? ` · ${providerParts(p.providerName).method}` : ""}</Row>
          <Row label="Source" testId="offer-source">{sourceDetail(p.quoteProvenance, p.quoteSourceNote, p.quoteObservedAt)}</Row>
          <Row label="Converted amount"><span className="num">{formatUsd(p.principalCents)}</span></Row>
          <Row label="Rate shown"><span className="num">{p.rate} KZT per USD</span></Row>
        </dl>
        <p className="muted small">Fingerprint of these figures:</p>
        <code className="hash" data-testid="proposal-hash">{proposal.hash}</code>
      </details>
    </Card>
  );
}

function ReceiptCard({ receipt: r }: { receipt: Receipt }) {
  return (
    <Card id="receipt" title="Receipt" aside={<Chip tone="info">SIMULATED</Chip>}>
      <p className="muted" data-testid="receipt-disclaimer">{r.disclaimer}</p>
      <div className="receipt-hero">
        <p><span>Debited from your USD balance</span><strong className="num" data-testid="receipt-debited">{formatUsd(r.totalDebitCents)}</strong></p>
        <p><span>Credited to the university (simulated)</span><strong className="num" data-testid="receipt-credited">{formatKzt(r.recipientTiynCredited)}</strong></p>
      </div>
      <dl className="rows" data-testid="receipt">
        <Row label="Payment ID"><code>{r.paymentId}</code></Row>
        <Row label="Executed at">{fmtTime(r.executedAt)}</Row>
        <Row label="USD balance before → after">{formatUsd(r.usdBalanceBeforeCents)} → {formatUsd(r.usdBalanceAfterCents)}</Row>
        <Row label="Beneficiary">{r.beneficiaryName} · <code>{r.beneficiaryAccount}</code></Row>
        <Row label="Provider / rate / fee">{r.provider} · {r.rate} KZT per USD · {formatUsd(r.feeCents)}</Row>
        <Row label="Rounding">{r.roundingNote}</Row>
      </dl>
      <details className="inline-details">
        <summary>Details</summary>
        <dl className="rows">
          <Row label="Approval ID"><code>{r.approvalId}</code></Row>
          <Row label="Fingerprint"><code className="hash">{r.proposalHash}</code></Row>
        </dl>
      </details>
    </Card>
  );
}

function Timeline({ events }: { events: TaskView["events"] }) {
  return (
    <>
      <h3>What the assistant did</h3>
      <ol className="timeline" data-testid="timeline">
        {events.map((e) => (
          <li key={e.seq} className={`ev ev-${e.kind}${e.ok === false ? " ev-fail" : ""}`}>
            {e.kind === "tool" ? (
              <>
                <div><code>{e.tool}</code> {e.ok ? <Chip tone="ok">ok</Chip> : <Chip tone="bad">rejected</Chip>} <span className="muted small">{summarize(e)}</span></div>
                <Details summary="Show input and output">
                  <pre>{JSON.stringify({ input: e.input, output: e.output }, null, 2)}</pre>
                </Details>
              </>
            ) : (
              <div className={e.kind === "assistant" ? "agent-text" : "muted"}>{e.kind === "assistant" ? "Agent comment: " : ""}{e.text}</div>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}

function summarize(e: TaskView["events"][number]): string {
  const o = e.output ?? {};
  if (!e.ok) { const er = (o as { error?: { code?: string; message?: string } }).error; return `${er?.code ?? "error"}: ${er?.message ?? ""}`; }
  switch (e.tool) {
    case "evaluate_routes": return o.noFeasibleRoute ? "no qualifying route" : `best quote ${String(o.bestQuoteId)}`;
    case "prepare_payment": return `proposal ${String(o.proposalId)} (no money moved)`;
    case "execute_sandbox_payment": return `payment ${String(o.paymentId)} (simulated)`;
    case "get_quotes": return `${(o.quotes as unknown[] | undefined)?.length ?? 0} simulated quotes`;
    default: return "";
  }
}
