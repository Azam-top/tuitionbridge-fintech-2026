import type { Ctx } from "../ctx.js";
import { newId, sha256Hex } from "../ids.js";
import { PolicyError } from "../errors.js";
import { type Tier, tierAllows } from "../auth.js";
import { canonicalJson } from "../../shared/canonical.js";
import { evaluateQuote, evaluateRoutes, type Preference } from "../../shared/policy.js";
import { getInvoice, validateInvoice } from "./invoices.js";
import { getQuote, latestQuotesForInvoice } from "./quotes.js";
import { getBalances } from "./ledger.js";
import { audit } from "./audit.js";

/** Every field here is bound by the SHA-256 proposal hash. Amounts are integer strings. */
export interface ProposalPayload {
  v: 1;
  ownerUserId: string;
  invoiceId: string;
  invoiceReference: string;
  recipientRegistryId: string;
  beneficiaryName: string;
  beneficiaryAccount: string;
  srcCcy: "USD";
  dstCcy: "KZT";
  tuitionTiyn: string;
  rate: string;
  feeCents: string;
  principalCents: string;
  totalDebitCents: string;
  recipientTiyn: string;
  surplusTiyn: string;
  quoteId: string;
  quoteVersion: number;
  providerId: string;
  providerName: string;
  estArrivalAt: string;
  deadlineAt: string;
  quoteExpiresAt: string;
  reserveCents: string;
  preference: Preference;
  proposalExpiresAt: string;
  /** Evidence that the server ranked the current quote set and this quote won the stated objective. */
  selection: {
    basis: "server_ranking_v1";
    objective: Preference;
    candidateQuoteIds: string[];
    rankedFeasibleQuoteIds: string[];
  };
}

export interface ProposalView {
  id: string;
  status: string;
  hash: string;
  payload: ProposalPayload;
  display: { usdBalanceBeforeCents: string; usdAfterCents: string };
  createdAt: string;
  expiresAt: string;
  approval: { id: string; approvedAt: string; expiresAt: string; consumedAt: string | null } | null;
}

export const hashPayload = (p: ProposalPayload): string => sha256Hex(canonicalJson(p));

interface ProposalRow {
  id: string; owner_user_id: string; invoice_id: string; quote_id: string; task_id: string | null; hash: string;
  payload_json: string; display_json: string; status: string; created_at: string; expires_at: string;
}
interface ApprovalRow {
  id: string; proposal_id: string; owner_user_id: string; proposal_hash: string; approved_at: string; expires_at: string; consumed_at: string | null;
}

export function getProposalRow(ctx: Ctx, ownerId: string, id: string): ProposalRow {
  const r = ctx.db.prepare("SELECT * FROM proposals WHERE id = ? AND owner_user_id = ?").get(id, ownerId) as ProposalRow | undefined;
  if (!r) throw new PolicyError("NOT_FOUND", "Proposal not found.");
  return r;
}

export function getApprovalForProposal(ctx: Ctx, proposalId: string): ApprovalRow | null {
  return (ctx.db.prepare("SELECT * FROM approvals WHERE proposal_id = ?").get(proposalId) as ApprovalRow | undefined) ?? null;
}

export function proposalView(ctx: Ctx, ownerId: string, id: string): ProposalView {
  const r = getProposalRow(ctx, ownerId, id);
  const a = getApprovalForProposal(ctx, id);
  return {
    id: r.id, status: r.status, hash: r.hash, payload: JSON.parse(r.payload_json) as ProposalPayload,
    display: JSON.parse(r.display_json) as ProposalView["display"], createdAt: r.created_at, expiresAt: r.expires_at,
    approval: a ? { id: a.id, approvedAt: a.approved_at, expiresAt: a.expires_at, consumedAt: a.consumed_at } : null,
  };
}

export interface PrepareInput {
  ownerId: string;
  tier: Tier;
  invoiceId: string;
  quoteId: string;
  preference: Preference;
  reserveCents: string;
  taskId?: string | null;
  mode?: string | null;
}

/** Creates an immutable proposal for exactly one fresh, feasible quote. Does NOT move money. */
export function prepareProposal(ctx: Ctx, input: PrepareInput): ProposalView {
  if (!tierAllows(input.tier, "propose")) throw new PolicyError("FORBIDDEN_TIER", "Proposing a payment requires the propose tier.");
  const id = newId("prop");
  ctx.db.transaction(() => {
    // Write-time guard: a proposal attributed to an agent task may only be created while that task is still running,
    // so a cancelled or finished task can never gain a proposal from a late tool call.
    if (input.taskId) {
      const task = ctx.db.prepare("SELECT state FROM agent_tasks WHERE id = ? AND owner_user_id = ?").get(input.taskId, input.ownerId) as { state: string } | undefined;
      if (!task || task.state !== "RUNNING") throw new PolicyError("TASK_STATE", "The task is no longer running, so no proposal was created.");
    }
    const inv = getInvoice(ctx, input.ownerId, input.invoiceId);
    if (inv.status === "PAID") throw new PolicyError("INVOICE_ALREADY_PAID", "Invoice is already paid.");
    if (inv.status !== "CONFIRMED") throw new PolicyError("INVOICE_NOT_CONFIRMED", "Invoice is not confirmed.");
    const issues = validateInvoice(ctx, inv);
    if (issues.some((i) => i.code === "RECIPIENT_MISMATCH" || i.code === "UNKNOWN_RECIPIENT")) {
      throw new PolicyError("RECIPIENT_MISMATCH", "Beneficiary does not match the trusted recipient registry.");
    }
    const quote = getQuote(ctx, input.ownerId, input.quoteId);
    const qRow = ctx.db.prepare("SELECT invoice_id FROM quotes WHERE id = ?").get(quote.id) as { invoice_id: string };
    if (qRow.invoice_id !== inv.id) throw new PolicyError("QUOTE_MISMATCH", "Quote was issued for a different invoice.");
    const bal = getBalances(ctx, input.ownerId);
    const now = ctx.clock.now();
    const ev = evaluateQuote(quote, {
      tuitionTiyn: BigInt(inv.amount_kzt_tiyn), deadlineAt: inv.due_at, now: now.toISOString(),
      usdBalanceCents: BigInt(bal.usd.balanceCents), usdReserveCents: BigInt(input.reserveCents),
    });
    if (!ev.feasible) {
      throw new PolicyError("ROUTE_NOT_FEASIBLE", `Route is not feasible: ${ev.exclusions.map((e) => e.message).join(" ")}`, {
        codes: ev.exclusions.map((e) => e.code),
      });
    }
    // The server, not the caller, decides which route is best for the stated objective. A feasible but
    // non-optimal (or superseded) quote is rejected; the model cannot bypass the ranking by naming a quote.
    const candidates = latestQuotesForInvoice(ctx, input.ownerId, inv.id);
    const ranking = evaluateRoutes({
      quotes: candidates, tuitionTiyn: BigInt(inv.amount_kzt_tiyn), deadlineAt: inv.due_at, now: now.toISOString(),
      usdBalanceCents: BigInt(bal.usd.balanceCents), usdReserveCents: BigInt(input.reserveCents), preference: input.preference,
    });
    if (!candidates.some((c) => c.id === quote.id)) {
      throw new PolicyError("QUOTE_SUPERSEDED", "That quote was replaced by a newer one from the same provider. Fetch and rank the current quotes.");
    }
    if (ranking.best?.quoteId !== quote.id) {
      throw new PolicyError(
        "ROUTE_NOT_OPTIMAL",
        `Quote ${quote.id} is feasible but is not the ${input.preference} route. The best ${input.preference} feasible route is ${ranking.best?.quoteId ?? "none"}.`,
        { objective: input.preference, bestQuoteId: ranking.best?.quoteId ?? null },
      );
    }
    const selection: ProposalPayload["selection"] = {
      basis: "server_ranking_v1", objective: input.preference,
      candidateQuoteIds: candidates.map((c) => c.id).sort(),
      rankedFeasibleQuoteIds: ranking.routes.filter((r) => r.feasible).map((r) => r.quoteId),
    };
    const expiresAt = quote.expiresAt;
    const payload: ProposalPayload = {
      v: 1, ownerUserId: input.ownerId, invoiceId: inv.id, invoiceReference: inv.reference,
      recipientRegistryId: inv.recipient_registry_id, beneficiaryName: inv.beneficiary_name, beneficiaryAccount: inv.beneficiary_account,
      srcCcy: "USD", dstCcy: "KZT", tuitionTiyn: inv.amount_kzt_tiyn, rate: quote.rate, feeCents: ev.feeCents,
      principalCents: ev.principalCents, totalDebitCents: ev.totalDebitCents, recipientTiyn: ev.recipientTiyn,
      surplusTiyn: ev.surplusTiyn, quoteId: quote.id, quoteVersion: quote.version, providerId: quote.providerId,
      providerName: quote.providerName, estArrivalAt: quote.estArrivalAt, deadlineAt: inv.due_at,
      quoteExpiresAt: quote.expiresAt, reserveCents: input.reserveCents, preference: input.preference, proposalExpiresAt: expiresAt,
      selection,
    };
    const hash = hashPayload(payload);
    // A new proposal supersedes any older pending one for this invoice (approval for the old one becomes unusable).
    ctx.db.prepare("UPDATE proposals SET status='SUPERSEDED' WHERE invoice_id=? AND owner_user_id=? AND status='PENDING'").run(inv.id, input.ownerId);
    ctx.db.prepare(
      `INSERT INTO proposals (id, owner_user_id, invoice_id, quote_id, task_id, hash, payload_json, display_json, status, created_at, expires_at)
       VALUES (?,?,?,?,?,?,?,?,'PENDING',?,?)`,
    ).run(id, input.ownerId, inv.id, quote.id, input.taskId ?? null, hash, JSON.stringify(payload),
      JSON.stringify({ usdBalanceBeforeCents: bal.usd.balanceCents, usdAfterCents: ev.usdAfterCents }), now.toISOString(), expiresAt);
  })();
  const view = proposalView(ctx, input.ownerId, id);
  audit(ctx.db, ctx.clock, {
    ownerUserId: input.ownerId, taskId: input.taskId ?? null, mode: input.mode ?? null, event: "proposal.created", result: "ALLOWED",
    refs: { proposalId: id, hash: view.hash, quoteId: input.quoteId },
  });
  return view;
}

export interface ApproveInput {
  ownerId: string;
  tier: Tier;
  proposalId: string;
  /** The hash the human saw on screen. Must match the stored proposal. */
  proposalHash: string;
}

/**
 * Human approval. Callable only from the authenticated HTTP endpoint; there is NO agent tool for this.
 * Idempotent per proposal: a repeated (double-click) approval returns the existing record.
 */
export function approveProposal(ctx: Ctx, input: ApproveInput): ProposalView {
  if (!tierAllows(input.tier, "execute")) throw new PolicyError("FORBIDDEN_TIER", "Approving a payment requires the execute tier.");
  const now = ctx.clock.now();
  try {
    ctx.db.transaction(() => {
      const p = getProposalRow(ctx, input.ownerId, input.proposalId);
      if (p.status !== "PENDING") throw new PolicyError("PROPOSAL_NOT_PENDING", `Proposal is ${p.status.toLowerCase()} and can no longer be approved.`);
      if (Date.parse(p.expires_at) <= now.getTime()) throw new PolicyError("PROPOSAL_EXPIRED", "Proposal has expired. Ask the agent to prepare a new one.");
      if (hashPayload(JSON.parse(p.payload_json) as ProposalPayload) !== p.hash) throw new PolicyError("PROPOSAL_TAMPERED", "Stored proposal does not match its hash.");
      if (input.proposalHash !== p.hash) throw new PolicyError("APPROVAL_MISMATCH", "The approved hash does not match the proposal on record.");
      const existing = getApprovalForProposal(ctx, p.id);
      if (existing) return;
      const approvalExpires = new Date(Math.min(now.getTime() + ctx.config.approvalTtlMs, Date.parse(p.expires_at))).toISOString();
      ctx.db.prepare("INSERT INTO approvals (id, proposal_id, owner_user_id, proposal_hash, approved_at, expires_at) VALUES (?,?,?,?,?,?)").run(
        newId("apr"), p.id, input.ownerId, p.hash, now.toISOString(), approvalExpires,
      );
    })();
  } catch (e) {
    if (e instanceof PolicyError) {
      audit(ctx.db, ctx.clock, { ownerUserId: input.ownerId, event: "approval.rejected", result: "REJECTED", refs: { proposalId: input.proposalId, code: e.code } });
    }
    throw e;
  }
  const view = proposalView(ctx, input.ownerId, input.proposalId);
  audit(ctx.db, ctx.clock, { ownerUserId: input.ownerId, event: "approval.granted", result: "ALLOWED", refs: { proposalId: view.id, approvalId: view.approval?.id ?? null, hash: view.hash } });
  return view;
}
