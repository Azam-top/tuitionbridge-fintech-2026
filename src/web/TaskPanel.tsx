import { useEffect, useRef, useState } from "react";
import { explain } from "./friendly";
import { api, ApiFailure, type Proposal, type Receipt, type RouteRow, type TaskView } from "./api";
import { Card, Chip, Details, Row } from "./components";
import { fmtRelative, fmtTime, formatKzt, formatUsd } from "./format";

const STATE_TEXT: Record<string, { tone: "ok" | "warn" | "bad" | "info" | "muted"; text: string }> = {
  RUNNING: { tone: "info", text: "Agent is working" },
  AWAITING_APPROVAL: { tone: "warn", text: "Waiting for your approval" },
  EXECUTING: { tone: "info", text: "Executing after your approval" },
  COMPLETED: { tone: "ok", text: "Completed (simulated)" },
  BLOCKED: { tone: "bad", text: "Blocked: nothing was paid" },
  FAILED: { tone: "bad", text: "Failed: nothing was paid unless a receipt is shown" },
  CANCELLED: { tone: "muted", text: "Cancelled" },
};

export function TaskPanel({ view, now, approvalMinutes, limits, onChanged, onError }: { view: TaskView; now: string; approvalMinutes: number; limits: { maxToolCalls: number; maxModelRequests: number }; onChanged: () => void; onError: (m: string) => void }) {
  const { task, events, proposal, receipt } = view;
  const st = STATE_TEXT[task.state] ?? { tone: "muted" as const, text: task.state };
  const evalEvent = [...events].reverse().find((e) => e.tool === "evaluate_routes" && e.ok);
  const routes = (evalEvent?.output?.routes as RouteRow[] | undefined) ?? null;
  const best = (evalEvent?.output?.bestQuoteId as string | null | undefined) ?? null;

  return (
    <div className="stack" data-testid="task-panel" data-task-state={task.state}>
      <p className="sr-only" role="status" aria-live="polite">{st.text}</p>
      <Card
        id="task"
        title="Agent task"
        aside={<Chip tone={st.tone}><span data-testid="task-state">{st.text}</span></Chip>}
      >
        <Intent task={task} />
        <p className="muted small">
          Agent: <strong>{task.mode}</strong>{task.model ? ` (${task.model})` : ""}. Payments: <strong>SIMULATED</strong>.
          {task.mode === "MOCK" && " This run used the deterministic stand-in, not a live model."}
        </p>
        {task.summary && <p className="agent-says" data-testid="agent-summary"><strong>Agent:</strong> {task.summary}</p>}
        {task.error && task.state !== "CANCELLED" && <p className="alert" role="alert" data-testid="task-error">{task.error}</p>}
        <Usage task={task} limits={limits} />
      </Card>

      {task.state === "AWAITING_APPROVAL" && proposal && <ApprovalCard taskId={task.id} proposal={proposal} now={now} approvalMinutes={approvalMinutes} onChanged={onChanged} onError={onError} />}
      {task.state === "EXECUTING" && <p role="status" className="muted">Executing your approved payment in the simulated ledger…</p>}
      {receipt && <ReceiptCard receipt={receipt} />}
      {routes && <Routes routes={routes} best={best} proposal={proposal} now={now} />}

      <Timeline events={events} />
    </div>
  );
}

function Intent({ task }: { task: TaskView["task"] }) {
  const i = task.intent;
  return (
    <div className="intent" data-testid="intent">
      <h3>What the agent understood</h3>
      <ul>
        <li>Route preference: <strong>{i.preference ?? "not stated (the agent may choose; defaults to cheapest feasible)"}</strong>{i.preferenceSource ? ` (${i.preferenceSource})` : ""}</li>
        <li>Keep for living costs: <strong>{formatUsd(i.reserveCents)}</strong> ({i.reserveSource === "instruction" ? "from your instruction" : "your account default"}). The agent cannot lower this.</li>
        <li>Deadline, amount and beneficiary: taken from the invoice you confirmed. The agent cannot change them.</li>
        <li className="muted">Your words: “{task.instruction}”</li>
      </ul>
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

function Routes({ routes, best, proposal, now }: { routes: RouteRow[]; best: string | null; proposal: Proposal | null; now: string }) {
  return (
    <Card id="routes" title="Route comparison (simulated quotes)">
      <div className="table-wrap">
        <table data-testid="routes-table">
          <thead>
            <tr><th>Provider</th><th>You will be debited</th><th>Fee</th><th>Recipient will receive</th><th>USD left after</th><th>Estimated arrival</th><th>Quote expires</th><th>Result</th></tr>
          </thead>
          <tbody>
            {routes.map((r) => (
              <tr key={r.quoteId} className={r.feasible ? (r.quoteId === best ? "best" : "") : "excluded"} data-testid={`route-${r.quoteId === best ? "best" : r.feasible ? "ok" : "excluded"}`}>
                <td>{r.provider}</td>
                <td>{r.totalDebit}</td>
                <td>{r.fee}</td>
                <td>{r.recipientWillReceive}{r.roundingSurplus !== "KZT 0.00" && <small className="muted"> (includes {r.roundingSurplus} rounding surplus)</small>}</td>
                <td>{r.usdAfterPayment}</td>
                <td title={r.estArrivalAt}>{fmtTime(r.estArrivalAt)}<br /><small className="muted">estimate, {fmtRelative(r.estArrivalAt, now)}</small></td>
                <td>{fmtTime(r.expiresAt)}</td>
                <td>
                  {r.feasible ? (r.quoteId === best ? <Chip tone="ok">Selected</Chip> : <Chip tone="info">Qualifies</Chip>) : (
                    <ul className="reasons">{r.exclusions.map((e, k) => <li key={k}><Chip tone="bad">{e.code.replace(/_/g, " ")}</Chip> {e.message}</li>)}</ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!best && <p className="alert" role="alert" data-testid="no-route">No route qualifies, so no payment was proposed.</p>}
      {proposal && <p className="muted small">Rate shown by each provider is KZT per USD; the fee is a fixed USD charge. No other FX margin is added.</p>}
    </Card>
  );
}

function ApprovalCard({ taskId, proposal, now, approvalMinutes, onChanged, onError }: { taskId: string; proposal: Proposal; now: string; approvalMinutes: number; onChanged: () => void; onError: (m: string) => void }) {
  const p = proposal.payload;
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
    <Card id="approval" title="Review and approve this exact payment" aside={<Chip tone="warn">Nothing has been paid yet</Chip>}>
      <div ref={heading} tabIndex={-1} className="focus-target" aria-label="Approval required: review the transaction below" />
      <dl className="rows" data-testid="approval-card">
        <Row label="Provider (simulated)">{p.providerName}</Row>
        <Row label="Invoice">{p.invoiceReference}</Row>
        <Row label="Recipient">{p.beneficiaryName}</Row>
        <Row label="Recipient registry ID">{p.recipientRegistryId}</Row>
        <Row label="Recipient account reference"><code data-testid="approval-account">{p.beneficiaryAccount}</code></Row>
        <Row label="Tuition due">{formatKzt(p.tuitionTiyn)}</Row>
        <Row label="Recipient will receive" strong testId="will-receive">{formatKzt(p.recipientTiyn)}{p.surplusTiyn !== "0" && <small className="muted"> (includes {formatKzt(p.surplusTiyn)} rounding surplus)</small>}</Row>
        <Row label="Rate (KZT per USD)">{p.rate}</Row>
        <Row label="USD to be converted">{formatUsd(p.principalCents)}</Row>
        <Row label="Provider fee (fixed, USD)">{formatUsd(p.feeCents)}</Row>
        <Row label="Total to be debited from your USD balance" strong testId="will-debit">{formatUsd(p.totalDebitCents)}</Row>
        <Row label="USD balance after payment (expected)">{formatUsd(proposal.display.usdAfterCents)}</Row>
        <Row label="Living-expense reserve kept">{formatUsd(p.reserveCents)}</Row>
        <Row label="Invoice deadline" testId="deadline">{fmtTime(p.deadlineAt)}</Row>
        <Row label="Estimated arrival (an estimate, not a guarantee)">{fmtTime(p.estArrivalAt)}</Row>
        <Row label="Quote expires" testId="quote-expiry">{fmtTime(p.quoteExpiresAt)} <small className="muted">({fmtRelative(p.quoteExpiresAt, now)})</small></Row>
        <Row label="Your approval stays valid for" testId="approval-expiry">{approvalMinutes} minutes after you approve, and never beyond the quote expiry</Row>
        <Row label="Proposal fingerprint (SHA-256)"><code className="hash" data-testid="proposal-hash">{proposal.hash}</code></Row>
      </dl>
      <p className="hint">Approving binds exactly the figures above. If anything changes, a new proposal and a new approval are required. Only you can approve; the agent cannot.</p>
      <div className="actions">
        <button className="btn btn-primary" onClick={approve} disabled={busy} data-testid="approve-btn">Approve and pay (simulated)</button>
        <button className="btn" onClick={reject} disabled={busy} data-testid="reject-btn">Reject</button>
      </div>
    </Card>
  );
}

function ReceiptCard({ receipt: r }: { receipt: Receipt }) {
  return (
    <Card id="receipt" title="Receipt" aside={<Chip tone="info">SIMULATED</Chip>}>
      <p className="muted" data-testid="receipt-disclaimer">{r.disclaimer}</p>
      <dl className="rows" data-testid="receipt">
        <Row label="Payment ID"><code>{r.paymentId}</code></Row>
        <Row label="Executed at">{fmtTime(r.executedAt)}</Row>
        <Row label="Debited from your USD balance" strong testId="receipt-debited">{formatUsd(r.totalDebitCents)}</Row>
        <Row label="Credited to the university (simulated)" strong testId="receipt-credited">{formatKzt(r.recipientTiynCredited)}</Row>
        <Row label="USD balance before → after">{formatUsd(r.usdBalanceBeforeCents)} → {formatUsd(r.usdBalanceAfterCents)}</Row>
        <Row label="Beneficiary">{r.beneficiaryName} · <code>{r.beneficiaryAccount}</code></Row>
        <Row label="Provider / rate / fee">{r.provider} · {r.rate} KZT per USD · {formatUsd(r.feeCents)}</Row>
        <Row label="Rounding">{r.roundingNote}</Row>
        <Row label="Approval ID"><code>{r.approvalId}</code></Row>
        <Row label="Proposal fingerprint"><code className="hash">{r.proposalHash}</code></Row>
      </dl>
    </Card>
  );
}

function Timeline({ events }: { events: TaskView["events"] }) {
  return (
    <Card id="timeline" title="What the agent did (actual tool events)">
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
              <div className={e.kind === "assistant" ? "agent-text" : "muted"}>{e.kind === "assistant" ? "Agent: " : ""}{e.text}</div>
            )}
          </li>
        ))}
      </ol>
    </Card>
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
