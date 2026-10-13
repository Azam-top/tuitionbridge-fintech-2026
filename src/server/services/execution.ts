import type { Ctx } from "../ctx.js";
import { newId, sha256Hex } from "../ids.js";
import { PolicyError } from "../errors.js";
import { type Tier, tierAllows } from "../auth.js";
import { canonicalJson } from "../../shared/canonical.js";
import { evaluateQuote } from "../../shared/policy.js";
import { hashPayload, type ProposalPayload } from "./proposals.js";
import { rowToQuote } from "./quotes.js";
import { audit } from "./audit.js";

export interface Receipt {
  paymentId: string;
  simulated: true;
  disclaimer: string;
  invoiceId: string;
  invoiceReference: string;
  proposalId: string;
  proposalHash: string;
  approvalId: string;
  idempotencyKey: string;
  provider: string;
  quoteId: string;
  quoteVersion: number;
  rate: string;
  principalCents: string;
  feeCents: string;
  totalDebitCents: string;
  tuitionTiyn: string;
  recipientTiynCredited: string;
  surplusTiyn: string;
  roundingNote: string;
  beneficiaryName: string;
  recipientRegistryId: string;
  beneficiaryAccount: string;
  estArrivalAt: string;
  deadlineAt: string;
  usdBalanceBeforeCents: string;
  usdBalanceAfterCents: string;
  reserveCents: string;
  executedAt: string;
}

export interface ExecuteInput {
  ownerId: string;
  tier: Tier;
  proposalId: string;
  approvalId: string;
  idempotencyKey: string;
  taskId?: string | null;
  mode?: string | null;
}

export interface ExecuteResult {
  receipt: Receipt;
  replayed: boolean;
}

const KEY_RE = /^[A-Za-z0-9:_\-.]{8,100}$/;

export function executionPayloadHash(i: Pick<ExecuteInput, "ownerId" | "proposalId" | "approvalId">, proposalHash: string): string {
  return sha256Hex(canonicalJson({ ownerUserId: i.ownerId, proposalId: i.proposalId, approvalId: i.approvalId, proposalHash }));
}

interface Row { [k: string]: string | number | null }

/**
 * The ONLY place money moves. Deliberately synchronous: one better-sqlite3 transaction with no await,
 * model call or network call inside, so authorization checks and ledger writes are atomic and short.
 * (Declared non-async on purpose; a test asserts this.)
 */
export function executePayment(ctx: Ctx, input: ExecuteInput): ExecuteResult {
  try {
    const result = ctx.db.transaction((): ExecuteResult => run(ctx, input)).immediate();
    return result;
  } catch (e) {
    if (e instanceof PolicyError) {
      // The transaction rolled back, so record the rejection outside it. No success event is written.
      audit(ctx.db, ctx.clock, {
        ownerUserId: input.ownerId, taskId: input.taskId ?? null, mode: input.mode ?? null, event: "payment.rejected", result: "REJECTED",
        refs: { proposalId: input.proposalId, approvalId: input.approvalId, code: e.code },
      });
    }
    throw e;
  }
}

function run(ctx: Ctx, input: ExecuteInput): ExecuteResult {
  const { db } = ctx;
  if (!tierAllows(input.tier, "execute")) throw new PolicyError("FORBIDDEN_TIER", "Executing a payment requires the execute tier.");
  if (!KEY_RE.test(input.idempotencyKey)) throw new PolicyError("VALIDATION", "Idempotency key must be 8-100 characters of [A-Za-z0-9:_-.].");
  const now = ctx.clock.now();

  const proposal = db.prepare("SELECT * FROM proposals WHERE id = ? AND owner_user_id = ?").get(input.proposalId, input.ownerId) as Row | undefined;
  if (!proposal) throw new PolicyError("NOT_FOUND", "Proposal not found.");
  const payloadHash = executionPayloadHash(input, String(proposal.hash));

  // Idempotency first: same key + same payload returns the original receipt; same key + different payload fails.
  const idem = db.prepare("SELECT payload_hash, payment_id FROM idempotency_keys WHERE owner_user_id = ? AND key = ?").get(input.ownerId, input.idempotencyKey) as
    | { payload_hash: string; payment_id: string } | undefined;
  if (idem) {
    if (idem.payload_hash !== payloadHash) throw new PolicyError("IDEMPOTENCY_CONFLICT", "This idempotency key was already used for a different payment request.");
    const pay = db.prepare("SELECT receipt_json FROM payments WHERE id = ?").get(idem.payment_id) as { receipt_json: string };
    return { receipt: JSON.parse(pay.receipt_json) as Receipt, replayed: true };
  }

  if (proposal.status === "EXECUTED") throw new PolicyError("DUPLICATE_PAYMENT", "This proposal has already been executed.");
  if (proposal.status !== "PENDING") throw new PolicyError("PROPOSAL_NOT_PENDING", `Proposal is ${String(proposal.status).toLowerCase()}.`);
  if (Date.parse(String(proposal.expires_at)) <= now.getTime()) throw new PolicyError("PROPOSAL_EXPIRED", "Proposal has expired.");
  const payload = JSON.parse(String(proposal.payload_json)) as ProposalPayload;
  if (hashPayload(payload) !== proposal.hash) throw new PolicyError("PROPOSAL_TAMPERED", "Stored proposal does not match its hash.");
  if (payload.ownerUserId !== input.ownerId) throw new PolicyError("NOT_FOUND", "Proposal not found.");

  const approval = db.prepare("SELECT * FROM approvals WHERE id = ? AND owner_user_id = ?").get(input.approvalId, input.ownerId) as Row | undefined;
  if (!approval) throw new PolicyError("APPROVAL_MISSING", "No valid human approval exists for this payment.");
  if (approval.proposal_id !== proposal.id || approval.proposal_hash !== proposal.hash) {
    throw new PolicyError("APPROVAL_MISMATCH", "Approval does not match this proposal.");
  }
  if (approval.consumed_at) throw new PolicyError("APPROVAL_CONSUMED", "This approval was already used.");
  if (Date.parse(String(approval.expires_at)) <= now.getTime()) throw new PolicyError("APPROVAL_EXPIRED", "Approval has expired.");

  const invoice = db.prepare("SELECT * FROM invoices WHERE id = ? AND owner_user_id = ?").get(payload.invoiceId, input.ownerId) as Row | undefined;
  if (!invoice) throw new PolicyError("NOT_FOUND", "Invoice not found.");
  if (invoice.status === "PAID") throw new PolicyError("DUPLICATE_PAYMENT", "This invoice has already been paid.");
  if (invoice.status !== "CONFIRMED") throw new PolicyError("INVOICE_NOT_CONFIRMED", "Invoice is not confirmed.");
  if (db.prepare("SELECT 1 FROM payments WHERE invoice_id = ?").get(payload.invoiceId)) throw new PolicyError("DUPLICATE_PAYMENT", "This invoice has already been paid.");
  // The invoice must still say exactly what was proposed.
  if (
    invoice.amount_kzt_tiyn !== payload.tuitionTiyn || invoice.recipient_registry_id !== payload.recipientRegistryId ||
    invoice.beneficiary_account !== payload.beneficiaryAccount || invoice.beneficiary_name !== payload.beneficiaryName ||
    invoice.due_at !== payload.deadlineAt
  ) {
    throw new PolicyError("PROPOSAL_NOT_PENDING", "Invoice changed after the proposal was made. A new proposal and approval are required.");
  }
  const trusted = db.prepare("SELECT name, account FROM trusted_recipients WHERE registry_id = ?").get(payload.recipientRegistryId) as { name: string; account: string } | undefined;
  if (!trusted || trusted.account !== payload.beneficiaryAccount || trusted.name !== payload.beneficiaryName) {
    throw new PolicyError("RECIPIENT_MISMATCH", "Beneficiary does not match the trusted recipient registry.");
  }

  const qrow = db.prepare("SELECT * FROM quotes WHERE id = ? AND owner_user_id = ?").get(payload.quoteId, input.ownerId);
  if (!qrow) throw new PolicyError("NOT_FOUND", "Quote not found.");
  const quote = rowToQuote(qrow as never);
  if (Date.parse(quote.expiresAt) <= now.getTime()) throw new PolicyError("QUOTE_EXPIRED", "The quote has expired. A fresh quote, proposal and approval are required.");
  if (quote.rate !== payload.rate || quote.feeCents !== payload.feeCents || quote.version !== payload.quoteVersion) {
    throw new PolicyError("QUOTE_MISMATCH", "Quote no longer matches the proposal.");
  }

  const usd = db.prepare("SELECT * FROM ledger_accounts WHERE owner_user_id = ? AND kind='user' AND currency='USD'").get(input.ownerId) as Row;
  const balance = BigInt(String(usd.balance_minor));
  const reserve = BigInt(payload.reserveCents);
  const ev = evaluateQuote(quote, {
    tuitionTiyn: BigInt(payload.tuitionTiyn), deadlineAt: payload.deadlineAt, now: now.toISOString(),
    usdBalanceCents: balance, usdReserveCents: reserve,
  });
  if (!ev.feasible) {
    const codes = ev.exclusions.map((e) => e.code);
    if (codes.includes("INSUFFICIENT_FUNDS")) throw new PolicyError("INSUFFICIENT_FUNDS", "Insufficient USD balance for this payment.");
    if (codes.includes("RESERVE_BREACH")) throw new PolicyError("RESERVE_BREACH", "This payment would drop USD below the living-expense reserve.");
    if (codes.includes("LATE")) throw new PolicyError("DEADLINE_MISSED", "The route no longer arrives by the deadline.");
    throw new PolicyError("ROUTE_NOT_FEASIBLE", ev.exclusions.map((e) => e.message).join(" "));
  }
  // Recomputed amounts must equal the bound amounts.
  if (ev.totalDebitCents !== payload.totalDebitCents || ev.recipientTiyn !== payload.recipientTiyn || ev.principalCents !== payload.principalCents) {
    throw new PolicyError("PROPOSAL_TAMPERED", "Recomputed amounts differ from the proposal.");
  }
  if (Date.parse(payload.deadlineAt) <= now.getTime()) throw new PolicyError("DEADLINE_MISSED", "The invoice deadline has passed.");

  // ---- all checks passed: write everything or nothing ----
  const total = BigInt(payload.totalDebitCents);
  const credited = BigInt(payload.recipientTiyn);
  const after = balance - total;
  const paymentId = newId("pay");
  const ts = now.toISOString();
  const shift = (accountId: string, delta: bigint, ccy: "USD" | "KZT") => {
    const r = db.prepare("SELECT balance_minor FROM ledger_accounts WHERE id = ?").get(accountId) as { balance_minor: string };
    db.prepare("UPDATE ledger_accounts SET balance_minor = ? WHERE id = ?").run((BigInt(r.balance_minor) + delta).toString(), accountId);
    db.prepare("INSERT INTO ledger_entries (id, payment_id, account_id, currency, delta_minor, created_at) VALUES (?,?,?,?,?,?)").run(
      newId("led"), paymentId, accountId, ccy, delta.toString(), ts,
    );
  };
  const receipt: Receipt = {
    paymentId, simulated: true,
    disclaimer: "SIMULATED sandbox payment. No real money moved; no real bank or payment provider was contacted.",
    invoiceId: payload.invoiceId, invoiceReference: payload.invoiceReference, proposalId: String(proposal.id), proposalHash: String(proposal.hash),
    approvalId: String(approval.id), idempotencyKey: input.idempotencyKey, provider: payload.providerName, quoteId: payload.quoteId,
    quoteVersion: payload.quoteVersion, rate: payload.rate, principalCents: payload.principalCents, feeCents: payload.feeCents,
    totalDebitCents: payload.totalDebitCents, tuitionTiyn: payload.tuitionTiyn, recipientTiynCredited: payload.recipientTiyn,
    surplusTiyn: payload.surplusTiyn,
    roundingNote: "The USD principal is rounded up to a whole cent, so the recipient receives the exact tuition plus the stated rounding surplus. The surplus is credited to the recipient, not refunded.",
    beneficiaryName: payload.beneficiaryName, recipientRegistryId: payload.recipientRegistryId, beneficiaryAccount: payload.beneficiaryAccount,
    estArrivalAt: payload.estArrivalAt, deadlineAt: payload.deadlineAt, usdBalanceBeforeCents: balance.toString(),
    usdBalanceAfterCents: after.toString(), reserveCents: payload.reserveCents, executedAt: ts,
  };
  db.prepare("INSERT INTO payments (id, owner_user_id, proposal_id, invoice_id, approval_id, receipt_json, created_at) VALUES (?,?,?,?,?,?,?)").run(
    paymentId, input.ownerId, proposal.id, payload.invoiceId, approval.id, JSON.stringify(receipt), ts,
  );
  shift(String(usd.id), -total, "USD");
  shift("acc_settle_usd", total, "USD");
  shift("acc_settle_kzt", -credited, "KZT");
  shift("acc_uni_kzt", credited, "KZT");
  db.prepare("UPDATE invoices SET status='PAID' WHERE id = ?").run(payload.invoiceId);
  db.prepare("UPDATE approvals SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL").run(ts, approval.id);
  db.prepare("UPDATE proposals SET status='EXECUTED' WHERE id = ?").run(proposal.id);
  db.prepare("INSERT INTO idempotency_keys (owner_user_id, key, payload_hash, payment_id) VALUES (?,?,?,?)").run(
    input.ownerId, input.idempotencyKey, payloadHash, paymentId,
  );
  audit(db, ctx.clock, {
    ownerUserId: input.ownerId, taskId: input.taskId ?? null, mode: input.mode ?? null, event: "payment.executed", result: "ALLOWED",
    refs: { paymentId, proposalId: String(proposal.id), approvalId: String(approval.id), simulated: true },
  });
  return { receipt, replayed: false };
}
