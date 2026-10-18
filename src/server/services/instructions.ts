// Live mode execution: the app does NOT move money. After the human approves an exact proposal, the app issues a payment
// INSTRUCTION. The user pays outside the app (their bank or the provider) and may attach evidence. The evidence is stored
// and hashed but never verified; nothing in this module says a bank confirmed anything.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Ctx } from "../ctx.js";
import { type Tier, tierAllows } from "../auth.js";
import { newId, sha256Hex } from "../ids.js";
import { PolicyError } from "../errors.js";
import { canonicalJson } from "../../shared/canonical.js";
import { evaluateQuote } from "../../shared/policy.js";
import { formatKzt, formatUsd } from "../../shared/money.js";
import { audit } from "./audit.js";
import { parseInput } from "./invoices.js";
import { getBalances } from "./ledger.js";
import { getQuote } from "./quotes.js";
import { getApprovalForProposal, getProposalRow, hashPayload, type ProposalPayload } from "./proposals.js";

export interface InstructionBody {
  v: 1;
  kind: "PAYMENT_INSTRUCTION";
  executedByApp: false;
  payTo: { name: string; account: string; recipientId: string };
  invoiceReference: string;
  provider: string;
  youPayUsdCents: string;
  providerFeeUsdCents: string;
  rate: string;
  universityShouldReceiveTiyn: string;
  mustStartPaymentBefore: string;
  invoiceDeadline: string;
  estimatedArrival: string;
  source: { provenance: string; note: string | null; observedAt: string | null };
  steps: string[];
}

export interface EvidenceView {
  id: string; kind: "user_marked_paid" | "bank_confirmation_upload"; label: string; reference: string | null;
  filename: string | null; mime: string | null; sizeBytes: number | null; sha256: string | null; createdAt: string;
}
export interface InstructionView {
  id: string; proposalId: string; invoiceId: string; status: "ISSUED" | "CANCELLED"; hash: string; createdAt: string;
  body: InstructionBody; evidence: EvidenceView[];
  /** Plain-language status. It never claims bank confirmation. */
  progress: "INSTRUCTION_ISSUED" | "MARKED_PAID_BY_USER" | "CONFIRMATION_FILE_UPLOADED" | "CANCELLED";
  progressLabel: string;
}

const LABELS = {
  user_marked_paid: "You marked this as paid. This is your own statement; it has not been checked against a bank.",
  bank_confirmation_upload: "You uploaded a confirmation file. The app stored it and recorded its hash; it did not verify the file or the payment.",
} as const;

function stepsFor(p: ProposalPayload): string[] {
  const common = [
    `Pay exactly the amount shown, to the recipient name and account shown, and use the invoice reference ${p.invoiceReference} as the payment reference.`,
  ];
  if (p.quoteProvenance === "PROVIDER_LIVE" && p.providerId.startsWith("wise:")) {
    return [
      "Open Wise (wise.com) and start a transfer from USD to KZT.",
      ...common,
      "Choose the pay-in method named in this offer. Compare the total and the rate Wise shows on its own screen with this page. If they differ materially, or the quote has expired, stop and plan again.",
      "Keep the confirmation Wise gives you and upload it below. Uploading is optional and is not verified by this app.",
    ];
  }
  return [
    `Open the channel that gave you the offer (${p.providerName}) and check that the offer is still valid and unchanged.`,
    ...common,
    "If the provider's rate, fee or total differs from this page, or the offer expired, stop and plan again.",
    "Keep the bank's confirmation and upload it below. Uploading is optional and is not verified by this app.",
  ];
}

function viewOf(ctx: Ctx, ownerId: string, id: string): InstructionView {
  const r = ctx.db.prepare("SELECT * FROM payment_instructions WHERE id = ? AND owner_user_id = ?").get(id, ownerId) as
    | { id: string; proposal_id: string; invoice_id: string; status: "ISSUED" | "CANCELLED"; instruction_json: string; instruction_hash: string; created_at: string } | undefined;
  if (!r) throw new PolicyError("NOT_FOUND", "Instruction not found.");
  const ev = (ctx.db.prepare("SELECT * FROM payment_evidence WHERE instruction_id = ? AND owner_user_id = ? ORDER BY created_at, rowid").all(id, ownerId) as {
    id: string; kind: EvidenceView["kind"]; reference: string | null; filename: string | null; mime: string | null; size_bytes: number | null; sha256: string | null; created_at: string;
  }[]).map((e) => ({ id: e.id, kind: e.kind, label: LABELS[e.kind], reference: e.reference, filename: e.filename, mime: e.mime, sizeBytes: e.size_bytes, sha256: e.sha256, createdAt: e.created_at }));
  const hasUpload = ev.some((e) => e.kind === "bank_confirmation_upload");
  const hasMark = ev.some((e) => e.kind === "user_marked_paid");
  const progress = r.status === "CANCELLED" ? "CANCELLED" : hasUpload ? "CONFIRMATION_FILE_UPLOADED" : hasMark ? "MARKED_PAID_BY_USER" : "INSTRUCTION_ISSUED";
  const progressLabel = {
    INSTRUCTION_ISSUED: "Instruction issued. The app has not moved any money; you pay outside the app.",
    MARKED_PAID_BY_USER: "You marked it as paid (not verified by a bank).",
    CONFIRMATION_FILE_UPLOADED: "Confirmation file uploaded by you (stored, not verified).",
    CANCELLED: "Cancelled. No payment was made through this instruction.",
  }[progress];
  return { id: r.id, proposalId: r.proposal_id, invoiceId: r.invoice_id, status: r.status, hash: r.instruction_hash, createdAt: r.created_at, body: JSON.parse(r.instruction_json) as InstructionBody, evidence: ev, progress, progressLabel };
}

export const getInstruction = viewOf;

export function instructionForProposal(ctx: Ctx, ownerId: string, proposalId: string): InstructionView | null {
  const r = ctx.db.prepare("SELECT id FROM payment_instructions WHERE proposal_id = ? AND owner_user_id = ?").get(proposalId, ownerId) as { id: string } | undefined;
  return r ? viewOf(ctx, ownerId, r.id) : null;
}

export function listInstructions(ctx: Ctx, ownerId: string): InstructionView[] {
  return (ctx.db.prepare("SELECT id FROM payment_instructions WHERE owner_user_id = ? ORDER BY created_at DESC, rowid DESC").all(ownerId) as { id: string }[]).map((r) => viewOf(ctx, ownerId, r.id));
}

/**
 * One synchronous transaction (no await, model or network call inside). Re-checks ownership, approval, hash, quote freshness,
 * deadline, balance and reserve; then writes the instruction, consumes the approval and locks the invoice.
 */
export function issueInstruction(ctx: Ctx, input: { ownerId: string; tier: Tier; proposalId: string }): InstructionView {
  if (ctx.config.appMode !== "live") throw new PolicyError("WRONG_MODE", "Payment instructions exist only in the live mode; the sandbox executes in its simulated ledger.");
  if (!tierAllows(input.tier, "execute")) throw new PolicyError("FORBIDDEN_TIER", "Issuing an instruction requires the execute tier.");
  const now = ctx.clock.now();
  const id = newId("ins");
  ctx.db.transaction(() => {
    const p = getProposalRow(ctx, input.ownerId, input.proposalId);
    if (p.status !== "PENDING") throw new PolicyError("PROPOSAL_NOT_PENDING", `Proposal is ${p.status.toLowerCase()} and cannot be turned into an instruction.`);
    const payload = JSON.parse(p.payload_json) as ProposalPayload;
    if (hashPayload(payload) !== p.hash) throw new PolicyError("PROPOSAL_TAMPERED", "Stored proposal does not match its hash.");
    const approval = getApprovalForProposal(ctx, p.id);
    if (!approval || approval.owner_user_id !== input.ownerId) throw new PolicyError("APPROVAL_MISSING", "No human approval exists for this proposal.");
    if (approval.proposal_hash !== p.hash) throw new PolicyError("APPROVAL_MISMATCH", "The approval does not match the proposal on record.");
    if (approval.consumed_at) throw new PolicyError("APPROVAL_CONSUMED", "This approval was already used.");
    if (Date.parse(approval.expires_at) <= now.getTime()) throw new PolicyError("APPROVAL_EXPIRED", "The approval has expired. Plan again.");
    const quote = getQuote(ctx, input.ownerId, payload.quoteId);
    if (Date.parse(quote.expiresAt) <= now.getTime()) throw new PolicyError("QUOTE_EXPIRED", "The offer has expired. Plan again with a current offer.");
    const inv = ctx.db.prepare("SELECT status FROM invoices WHERE id = ? AND owner_user_id = ?").get(payload.invoiceId, input.ownerId) as { status: string } | undefined;
    if (!inv || inv.status !== "CONFIRMED") throw new PolicyError("INVOICE_NOT_CONFIRMED", "The invoice is no longer confirmed.");
    const bal = getBalances(ctx, input.ownerId);
    const ev = evaluateQuote(quote, {
      tuitionTiyn: BigInt(payload.tuitionTiyn), deadlineAt: payload.deadlineAt, now: now.toISOString(),
      usdBalanceCents: BigInt(bal.usd.balanceCents), usdReserveCents: BigInt(payload.reserveCents),
    });
    if (!ev.feasible) throw new PolicyError("ROUTE_NOT_FEASIBLE", ev.exclusions.map((e) => e.message).join(" "));
    if (ev.totalDebitCents !== payload.totalDebitCents || ev.principalCents !== payload.principalCents || ev.recipientTiyn !== payload.recipientTiyn) {
      throw new PolicyError("PROPOSAL_TAMPERED", "Recomputed amounts differ from the proposal.");
    }
    const body: InstructionBody = {
      v: 1, kind: "PAYMENT_INSTRUCTION", executedByApp: false,
      payTo: { name: payload.beneficiaryName, account: payload.beneficiaryAccount, recipientId: payload.recipientRegistryId },
      invoiceReference: payload.invoiceReference, provider: payload.providerName, youPayUsdCents: payload.totalDebitCents, providerFeeUsdCents: payload.feeCents,
      rate: payload.rate, universityShouldReceiveTiyn: payload.recipientTiyn, mustStartPaymentBefore: payload.quoteExpiresAt, invoiceDeadline: payload.deadlineAt,
      estimatedArrival: payload.estArrivalAt, source: { provenance: payload.quoteProvenance, note: payload.quoteSourceNote, observedAt: payload.quoteObservedAt }, steps: stepsFor(payload),
    };
    const json = canonicalJson(body);
    ctx.db.prepare(
      "INSERT INTO payment_instructions (id, owner_user_id, proposal_id, invoice_id, approval_id, instruction_json, instruction_hash, status, created_at) VALUES (?,?,?,?,?,?,?,'ISSUED',?)",
    ).run(id, input.ownerId, p.id, payload.invoiceId, approval.id, json, sha256Hex(json), now.toISOString());
    ctx.db.prepare("UPDATE approvals SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL").run(now.toISOString(), approval.id);
    ctx.db.prepare("UPDATE proposals SET status = 'INSTRUCTED' WHERE id = ? AND status = 'PENDING'").run(p.id);
    ctx.db.prepare("UPDATE invoices SET status = 'INSTRUCTED' WHERE id = ? AND owner_user_id = ? AND status = 'CONFIRMED'").run(payload.invoiceId, input.ownerId);
  })();
  audit(ctx.db, ctx.clock, { ownerUserId: input.ownerId, event: "instruction.issued", result: "ALLOWED", refs: { instructionId: id, proposalId: input.proposalId } });
  return viewOf(ctx, input.ownerId, id);
}

/** Human summary of an instruction for the task summary line. Built from the stored body only. */
export function instructionSummary(v: InstructionView): string {
  const b = v.body;
  return `Approved. Payment instruction issued: pay ${formatUsd(b.youPayUsdCents)} via ${b.provider}, so that ${b.payTo.name} should receive ${formatKzt(b.universityShouldReceiveTiyn)}. ` +
    "The app has not moved any money; you pay outside the app and may upload your confirmation.";
}

// ---------------------------------------------------------------- user evidence (never treated as bank verification)
function mustBeIssued(ctx: Ctx, ownerId: string, instructionId: string): InstructionView {
  const v = viewOf(ctx, ownerId, instructionId);
  if (v.status !== "ISSUED") throw new PolicyError("TASK_STATE", "This instruction was cancelled.");
  return v;
}

export function markPaidByUser(ctx: Ctx, ownerId: string, instructionId: string, raw: unknown): InstructionView {
  const v = parseInput(z.object({ reference: z.string().trim().max(100).optional() }).strict(), raw ?? {});
  const cur = mustBeIssued(ctx, ownerId, instructionId);
  if (cur.evidence.some((e) => e.kind === "user_marked_paid")) throw new PolicyError("VALIDATION", "You already marked this instruction as paid.");
  ctx.db.prepare("INSERT INTO payment_evidence (id, instruction_id, owner_user_id, kind, reference, created_at) VALUES (?,?,?,?,?,?)").run(
    newId("evd"), instructionId, ownerId, "user_marked_paid", v.reference || null, ctx.clock.now().toISOString(),
  );
  audit(ctx.db, ctx.clock, { ownerUserId: ownerId, event: "instruction.user_marked_paid", result: "INFO", refs: { instructionId } });
  return viewOf(ctx, ownerId, instructionId);
}

const MAGIC: [string, string, number[]][] = [
  ["application/pdf", "pdf", [0x25, 0x50, 0x44, 0x46, 0x2d]],
  ["image/png", "png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ["image/jpeg", "jpg", [0xff, 0xd8, 0xff]],
];

export function uploadConfirmation(ctx: Ctx, ownerId: string, instructionId: string, raw: unknown): InstructionView {
  const v = parseInput(z.object({ filename: z.string().trim().min(1).max(200), dataBase64: z.string().max(4_000_000), reference: z.string().trim().max(100).optional() }).strict(), raw);
  mustBeIssued(ctx, ownerId, instructionId);
  if (!/^[A-Za-z0-9+/=]+$/.test(v.dataBase64)) throw new PolicyError("VALIDATION", "The file is not valid base64.");
  const buf = Buffer.from(v.dataBase64, "base64");
  if (buf.length === 0 || buf.length > ctx.config.maxUploadBytes) throw new PolicyError("VALIDATION", `The file must be between 1 byte and ${Math.round(ctx.config.maxUploadBytes / 1024)} KB.`);
  const kind = MAGIC.find(([, , sig]) => sig.every((b, i) => buf[i] === b));
  if (!kind) throw new PolicyError("VALIDATION", "Only PDF, PNG or JPEG files are accepted (checked by file signature, not by name).");
  const sha = createHash("sha256").update(buf).digest("hex");
  const dir = join(ctx.config.uploadDir, ownerId);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stored = join(dir, `${sha}.${kind[1]}`);
  writeFileSync(stored, buf, { mode: 0o600 });
  const display = v.filename.replace(/[\\/]/g, "_").slice(0, 100);
  ctx.db.prepare(
    "INSERT INTO payment_evidence (id, instruction_id, owner_user_id, kind, reference, filename, mime, size_bytes, sha256, stored_path, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
  ).run(newId("evd"), instructionId, ownerId, "bank_confirmation_upload", v.reference || null, display, kind[0], buf.length, sha, stored, ctx.clock.now().toISOString());
  audit(ctx.db, ctx.clock, { ownerUserId: ownerId, event: "instruction.confirmation_uploaded", result: "INFO", refs: { instructionId, sha256: sha } });
  return viewOf(ctx, ownerId, instructionId);
}

/** Cancel an instruction that has no evidence yet, so the invoice can be planned again. */
export function cancelInstruction(ctx: Ctx, ownerId: string, instructionId: string): InstructionView {
  const cur = mustBeIssued(ctx, ownerId, instructionId);
  if (cur.evidence.length) throw new PolicyError("VALIDATION", "An instruction with evidence attached cannot be cancelled.");
  ctx.db.transaction(() => {
    ctx.db.prepare("UPDATE payment_instructions SET status = 'CANCELLED' WHERE id = ? AND owner_user_id = ? AND status = 'ISSUED'").run(instructionId, ownerId);
    ctx.db.prepare("UPDATE invoices SET status = 'CONFIRMED' WHERE id = ? AND owner_user_id = ? AND status = 'INSTRUCTED'").run(cur.invoiceId, ownerId);
  })();
  audit(ctx.db, ctx.clock, { ownerUserId: ownerId, event: "instruction.cancelled", result: "INFO", refs: { instructionId } });
  return viewOf(ctx, ownerId, instructionId);
}
