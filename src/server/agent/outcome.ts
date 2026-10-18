// Deterministic task summaries. Every figure and status here is read from stored records
// (proposal payload, payment receipt, tool results); none of it comes from model prose.

import type { Ctx } from "../ctx.js";
import { formatKzt, formatUsd } from "../../shared/money.js";
import type { ProposalPayload } from "../services/proposals.js";
import type { Receipt } from "../services/execution.js";

export function proposalPayload(ctx: Ctx, proposalId: string | null): ProposalPayload | null {
  if (!proposalId) return null;
  const r = ctx.db.prepare("SELECT payload_json FROM proposals WHERE id = ?").get(proposalId) as { payload_json: string } | undefined;
  return r ? (JSON.parse(r.payload_json) as ProposalPayload) : null;
}

export function receiptForProposal(ctx: Ctx, proposalId: string | null): Receipt | null {
  if (!proposalId) return null;
  const r = ctx.db.prepare("SELECT receipt_json FROM payments WHERE proposal_id = ?").get(proposalId) as { receipt_json: string } | undefined;
  return r ? (JSON.parse(r.receipt_json) as Receipt) : null;
}

export function approvalExists(ctx: Ctx, proposalId: string | null): boolean {
  if (!proposalId) return false;
  return !!ctx.db.prepare("SELECT 1 FROM approvals WHERE proposal_id = ?").get(proposalId);
}

interface ToolEventRow { tool: string; ok: number; output_json: string | null }

function lastToolEvent(ctx: Ctx, taskId: string, tool: string): { ok: boolean; data: Record<string, unknown> } | null {
  const r = ctx.db.prepare("SELECT tool, ok, output_json FROM agent_events WHERE task_id = ? AND kind = 'tool' AND tool = ? ORDER BY seq DESC LIMIT 1").get(taskId, tool) as ToolEventRow | undefined;
  if (!r?.output_json) return null;
  try { return { ok: r.ok === 1, data: JSON.parse(r.output_json) as Record<string, unknown> }; } catch { return null; }
}

function lastFailure(ctx: Ctx, taskId: string): string | null {
  const r = ctx.db.prepare("SELECT output_json FROM agent_events WHERE task_id = ? AND kind = 'tool' AND ok = 0 ORDER BY seq DESC LIMIT 1").get(taskId) as { output_json: string | null } | undefined;
  if (!r?.output_json) return null;
  try {
    const e = (JSON.parse(r.output_json) as { error?: { code?: string; message?: string } }).error;
    return e?.message ? `${e.message}` : null;
  } catch { return null; }
}

export function proposalSummary(p: ProposalPayload): string {
  return `Proposal ready for your approval: you would be debited ${formatUsd(p.totalDebitCents)} through ${p.providerName}, ` +
    `and the university would receive ${formatKzt(p.recipientTiyn)} (estimated arrival ${p.estArrivalAt}, quote valid until ${p.quoteExpiresAt}). ` +
    "Nothing has been paid yet.";
}

export function receiptSummary(r: Receipt): string {
  return `Payment completed in the SIMULATED ledger (${r.paymentId}): ${formatUsd(r.totalDebitCents)} debited through ${r.provider}, ` +
    `${formatKzt(r.recipientTiynCredited)} credited to the university account. This is a sandbox record, not a bank transfer.`;
}

/** Why a task ended without a proposal or payment, from tool results only. */
export function blockedSummary(ctx: Ctx, taskId: string, phase: "prepare" | "execute"): string {
  if (phase === "execute") {
    const why = lastFailure(ctx, taskId);
    return `The payment was not executed.${why ? ` ${why}` : ""} No money moved.`;
  }
  const ev = lastToolEvent(ctx, taskId, "evaluate_routes");
  if (ev?.ok && ev.data.noFeasibleRoute) {
    const routes = (ev.data.routes as { provider: string; exclusions: { message: string }[] }[] | undefined) ?? [];
    const why = routes.map((r) => `${r.provider}: ${r.exclusions.map((x) => x.message).join(" ")}`).join(" | ");
    return `No route qualifies, so no payment was prepared. ${why}`.trim();
  }
  const why = lastFailure(ctx, taskId);
  return `No payment was prepared.${why ? ` ${why}` : ""}`;
}
