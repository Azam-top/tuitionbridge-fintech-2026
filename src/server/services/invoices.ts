import { z } from "zod";
import type { Ctx } from "../ctx.js";
import { newId } from "../ids.js";
import { PolicyError } from "../errors.js";
import { audit } from "./audit.js";
import { parseMinor } from "../../shared/money.js";
import { linkRecipientByAccount } from "./recipients.js";

export interface InvoiceRow {
  id: string;
  owner_user_id: string;
  reference: string;
  recipient_registry_id: string;
  beneficiary_name: string;
  beneficiary_account: string;
  amount_kzt_tiyn: string;
  due_at: string;
  source_type: string;
  notes: string;
  ambiguous_fields: string;
  status: "DRAFT" | "BLOCKED" | "CONFIRMED" | "INSTRUCTED" | "PAID";
  issues_json: string;
  created_at: string;
  confirmed_at: string | null;
}

export interface Issue {
  code: "MISSING_FIELD" | "AMBIGUOUS" | "RECIPIENT_MISMATCH" | "UNKNOWN_RECIPIENT" | "DUE_PASSED" | "INVALID_FIELD";
  field?: string;
  message: string;
}

export interface InvoiceView {
  id: string;
  reference: string;
  recipientRegistryId: string;
  beneficiaryName: string;
  beneficiaryAccount: string;
  amountKztTiyn: string;
  dueAt: string;
  sourceType: string;
  notes: string; // UNTRUSTED text; display only
  ambiguousFields: string[];
  status: InvoiceRow["status"];
  issues: Issue[];
  confirmedAt: string | null;
}

export const toView = (r: InvoiceRow): InvoiceView => ({
  id: r.id, reference: r.reference, recipientRegistryId: r.recipient_registry_id, beneficiaryName: r.beneficiary_name,
  beneficiaryAccount: r.beneficiary_account, amountKztTiyn: r.amount_kzt_tiyn, dueAt: r.due_at, sourceType: r.source_type,
  notes: r.notes, ambiguousFields: JSON.parse(r.ambiguous_fields) as string[], status: r.status,
  issues: JSON.parse(r.issues_json) as Issue[], confirmedAt: r.confirmed_at,
});

const text = (max: number) => z.string().trim().min(1).max(max);
export const InvoiceInput = z.object({
  reference: text(64),
  recipientRegistryId: z.string().trim().max(64), // may be empty in the live mode: it is linked from the user's attested recipients
  beneficiaryName: text(200),
  beneficiaryAccount: text(64),
  amountKztTiyn: z.string().regex(/^\d{1,15}$/),
  dueAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "invalid timestamp"),
  sourceType: z.enum(["manual", "structured", "text_pdf", "synthetic_example"]).default("manual"),
  notes: z.string().max(2000).default(""),
  ambiguousFields: z.array(z.string().max(40)).max(10).default([]),
});
export const InvoicePatch = InvoiceInput.partial().strict();

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const normAcct = (s: string) => s.replace(/\s+/g, "").toUpperCase();

/** Recoverable validation. Returns issues; an empty list means the invoice may be confirmed. */
export function validateInvoice(ctx: Ctx, r: InvoiceRow): Issue[] {
  const issues: Issue[] = [];
  const req: [keyof InvoiceRow, string][] = [
    ["reference", "reference"], ["recipient_registry_id", "recipientRegistryId"], ["beneficiary_name", "beneficiaryName"],
    ["beneficiary_account", "beneficiaryAccount"], ["amount_kzt_tiyn", "amountKztTiyn"], ["due_at", "dueAt"],
  ];
  for (const [col, field] of req) {
    if (col === "recipient_registry_id" && ctx.config.appMode === "live") continue; // reported as UNKNOWN_RECIPIENT below
    if (!String(r[col] ?? "").trim()) issues.push({ code: "MISSING_FIELD", field, message: `${field} is missing.` });
  }
  for (const f of JSON.parse(r.ambiguous_fields) as string[]) {
    issues.push({ code: "AMBIGUOUS", field: f, message: `The value for ${f} is ambiguous. Re-enter it explicitly; the system will not guess.` });
  }
  try {
    if (parseMinor(r.amount_kzt_tiyn) <= 0n) issues.push({ code: "INVALID_FIELD", field: "amountKztTiyn", message: "Amount must be positive." });
  } catch {
    issues.push({ code: "INVALID_FIELD", field: "amountKztTiyn", message: "Amount is not a valid number of tiyn." });
  }
  if (Date.parse(r.due_at) <= ctx.clock.now().getTime()) {
    issues.push({ code: "DUE_PASSED", field: "dueAt", message: "The due date has already passed." });
  }
  const trusted = ctx.db.prepare("SELECT name, account FROM trusted_recipients WHERE registry_id = ? AND (owner_user_id IS NULL OR owner_user_id = ?)").get(r.recipient_registry_id, r.owner_user_id) as
    | { name: string; account: string } | undefined;
  if (!trusted) {
    issues.push({
      code: "UNKNOWN_RECIPIENT", field: "recipientRegistryId",
      message: ctx.config.appMode === "live"
        ? "This beneficiary is not one of your attested recipients. Add it first from the university's official payment page (name, account and the page's address); an invoice cannot add it."
        : "This recipient registry ID is not in the trusted registry.",
    });
  } else if (norm(trusted.name) !== norm(r.beneficiary_name) || normAcct(trusted.account) !== normAcct(r.beneficiary_account)) {
    issues.push({
      code: "RECIPIENT_MISMATCH",
      message:
        "Beneficiary name or account differs from the trusted registry entry for this recipient. This is a mismatch to review, not a proven fraud finding. Correct the invoice or contact the university.",
    });
  }
  return issues;
}

export function getInvoice(ctx: Ctx, ownerId: string, id: string): InvoiceRow {
  const r = ctx.db.prepare("SELECT * FROM invoices WHERE id = ? AND owner_user_id = ?").get(id, ownerId) as InvoiceRow | undefined;
  if (!r) throw new PolicyError("NOT_FOUND", "Invoice not found.");
  return r;
}

export function listInvoices(ctx: Ctx, ownerId: string): InvoiceView[] {
  return (ctx.db.prepare("SELECT * FROM invoices WHERE owner_user_id = ? ORDER BY created_at, id").all(ownerId) as InvoiceRow[]).map(toView);
}

export function createInvoice(ctx: Ctx, ownerId: string, raw: unknown): InvoiceView {
  const v = parseInput(InvoiceInput, raw);
  const dup = ctx.db.prepare("SELECT 1 FROM invoices WHERE owner_user_id = ? AND reference = ?").get(ownerId, v.reference);
  if (dup) throw new PolicyError("VALIDATION", "An invoice with this reference already exists.");
  const id = newId("inv");
  ctx.db.prepare(
    `INSERT INTO invoices (id, owner_user_id, reference, recipient_registry_id, beneficiary_name, beneficiary_account,
       amount_kzt_tiyn, due_at, source_type, notes, ambiguous_fields, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,'DRAFT',?)`,
  ).run(id, ownerId, v.reference, v.recipientRegistryId, v.beneficiaryName, v.beneficiaryAccount, v.amountKztTiyn,
    new Date(v.dueAt).toISOString(), v.sourceType, v.notes, JSON.stringify(v.ambiguousFields), ctx.clock.now().toISOString());
  audit(ctx.db, ctx.clock, { ownerUserId: ownerId, event: "invoice.created", result: "INFO", refs: { invoiceId: id, source: v.sourceType } });
  return toView(getInvoice(ctx, ownerId, id));
}

/** Correct an invoice. Any edit returns it to DRAFT and supersedes open proposals; it must be re-confirmed. */
export function updateInvoice(ctx: Ctx, ownerId: string, id: string, raw: unknown): InvoiceView {
  const patch = parseInput(InvoicePatch, raw);
  const cur = getInvoice(ctx, ownerId, id);
  if (cur.status === "PAID" || cur.status === "INSTRUCTED") throw new PolicyError("INVOICE_ALREADY_PAID", "An invoice with a payment instruction or a payment cannot be edited.");
  const ambiguous = new Set(JSON.parse(cur.ambiguous_fields) as string[]);
  const fieldOfKey: Record<string, string> = {
    reference: "reference", recipientRegistryId: "recipientRegistryId", beneficiaryName: "beneficiaryName",
    beneficiaryAccount: "beneficiaryAccount", amountKztTiyn: "amountKztTiyn", dueAt: "dueAt",
  };
  for (const k of Object.keys(patch)) if (fieldOfKey[k]) ambiguous.delete(fieldOfKey[k]);
  const next = {
    reference: patch.reference ?? cur.reference,
    recipient_registry_id: patch.recipientRegistryId ?? cur.recipient_registry_id,
    beneficiary_name: patch.beneficiaryName ?? cur.beneficiary_name,
    beneficiary_account: patch.beneficiaryAccount ?? cur.beneficiary_account,
    amount_kzt_tiyn: patch.amountKztTiyn ?? cur.amount_kzt_tiyn,
    due_at: patch.dueAt ? new Date(patch.dueAt).toISOString() : cur.due_at,
    notes: patch.notes ?? cur.notes,
  };
  ctx.db.transaction(() => {
    ctx.db.prepare(
      `UPDATE invoices SET reference=?, recipient_registry_id=?, beneficiary_name=?, beneficiary_account=?, amount_kzt_tiyn=?,
         due_at=?, notes=?, ambiguous_fields=?, status='DRAFT', issues_json='[]', confirmed_at=NULL WHERE id=? AND owner_user_id=?`,
    ).run(next.reference, next.recipient_registry_id, next.beneficiary_name, next.beneficiary_account, next.amount_kzt_tiyn,
      next.due_at, next.notes, JSON.stringify([...ambiguous]), id, ownerId);
    ctx.db.prepare("UPDATE proposals SET status='SUPERSEDED' WHERE invoice_id=? AND owner_user_id=? AND status='PENDING'").run(id, ownerId);
  })();
  audit(ctx.db, ctx.clock, { ownerUserId: ownerId, event: "invoice.edited", result: "INFO", refs: { invoiceId: id } });
  return toView(getInvoice(ctx, ownerId, id));
}

/** Human confirmation. Revalidates; blocked state is recoverable by editing and confirming again. */
export function confirmInvoice(ctx: Ctx, ownerId: string, id: string): InvoiceView {
  let cur = getInvoice(ctx, ownerId, id);
  if (cur.status === "PAID" || cur.status === "INSTRUCTED") throw new PolicyError("INVOICE_ALREADY_PAID", "A payment instruction was already issued for this invoice.");
  linkRecipientByAccount(ctx, ownerId, id);
  cur = getInvoice(ctx, ownerId, id);
  const issues = validateInvoice(ctx, cur);
  const status = issues.length ? "BLOCKED" : "CONFIRMED";
  ctx.db.prepare("UPDATE invoices SET status=?, issues_json=?, confirmed_at=? WHERE id=? AND owner_user_id=?").run(
    status, JSON.stringify(issues), status === "CONFIRMED" ? ctx.clock.now().toISOString() : null, id, ownerId,
  );
  audit(ctx.db, ctx.clock, {
    ownerUserId: ownerId, event: "invoice.confirm", result: status === "CONFIRMED" ? "ALLOWED" : "REJECTED",
    refs: { invoiceId: id, issueCodes: issues.map((i) => i.code).join(",") },
  });
  return toView(getInvoice(ctx, ownerId, id));
}

export function parseInput<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const r = schema.safeParse(raw);
  if (!r.success) {
    const issues = r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    // Say which field and why, so the user can fix it (field names and messages are our own, never user text).
    throw new PolicyError("VALIDATION", `Invalid input: ${issues.slice(0, 3).map((i) => (i.path ? `${i.path}: ` : "") + i.message).join("; ")}`, { issues });
  }
  return r.data;
}
