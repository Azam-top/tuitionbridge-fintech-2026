import { z } from "zod";
import type { Ctx } from "../ctx.js";
import { newId } from "../ids.js";
import { PolicyError } from "../errors.js";
import { audit } from "./audit.js";
import { parseInput } from "./invoices.js";

export interface RecipientView {
  id: string; name: string; account: string; origin: "test_fixture" | "user_attested";
  sourceUrl: string | null; sourceNote: string | null; attestedAt: string | null;
}

const normAcct = (s: string) => s.replace(/\s+/g, "").toUpperCase();

/** ISO 13616 mod-97 check. Used only when the account has the IBAN shape; a failing checksum is a strong typo signal. */
export function ibanChecksumOk(account: string): boolean {
  const a = normAcct(account);
  const rearranged = a.slice(4) + a.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const v = ch >= "A" ? ch.charCodeAt(0) - 55 : Number(ch);
    rem = Number(`${rem}${v}`) % 97;
  }
  return rem === 1;
}
export const looksLikeIban = (account: string): boolean => /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(normAcct(account));

const AttestInput = z.object({
  name: z.string().trim().min(3).max(200),
  account: z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9 ]+$/, "Use letters, digits and spaces only."),
  sourceUrl: z.string().trim().url().max(500).refine((u) => u.startsWith("https://"), "The source must be an https:// page."),
  sourceNote: z.string().trim().min(3).max(300),
}).strict();

/**
 * The signed-in user attests a recipient from an official page they name. This is the ONLY way a recipient becomes
 * trusted in the live mode; invoices and documents can never create or change one.
 */
export function attestRecipient(ctx: Ctx, ownerId: string, raw: unknown): RecipientView {
  if (ctx.config.appMode !== "live") throw new PolicyError("WRONG_MODE", "Recipient attestation exists only in the live mode.");
  const v = parseInput(AttestInput, raw);
  if (looksLikeIban(v.account) && !ibanChecksumOk(v.account)) {
    throw new PolicyError("VALIDATION", "This account looks like an IBAN but its checksum is wrong. Re-copy it from the official page; a single wrong character sends money elsewhere.");
  }
  const acct = normAcct(v.account);
  const dup = ctx.db.prepare("SELECT 1 FROM trusted_recipients WHERE owner_user_id = ? AND REPLACE(UPPER(account), ' ', '') = ?").get(ownerId, acct);
  if (dup) throw new PolicyError("VALIDATION", "You have already attested a recipient with this account.");
  const id = newId("rec");
  const now = ctx.clock.now().toISOString();
  ctx.db.prepare(
    "INSERT INTO trusted_recipients (registry_id, name, account, owner_user_id, origin, source_url, source_note, attested_at) VALUES (?,?,?,?,'user_attested',?,?,?)",
  ).run(id, v.name, acct, ownerId, v.sourceUrl, v.sourceNote, now);
  audit(ctx.db, ctx.clock, { ownerUserId: ownerId, event: "recipient.attested", result: "ALLOWED", refs: { recipientId: id } });
  return { id, name: v.name, account: acct, origin: "user_attested", sourceUrl: v.sourceUrl, sourceNote: v.sourceNote, attestedAt: now };
}

export function listRecipients(ctx: Ctx, ownerId: string): RecipientView[] {
  return (ctx.db.prepare("SELECT * FROM trusted_recipients WHERE owner_user_id = ? ORDER BY attested_at, registry_id").all(ownerId) as {
    registry_id: string; name: string; account: string; origin: "test_fixture" | "user_attested"; source_url: string | null; source_note: string | null; attested_at: string | null;
  }[]).map((r) => ({ id: r.registry_id, name: r.name, account: r.account, origin: r.origin, sourceUrl: r.source_url, sourceNote: r.source_note, attestedAt: r.attested_at }));
}

/**
 * Live mode: link an invoice to the user's attested recipient whose account matches exactly. It only SELECTS among
 * entries the user already attested; it never creates or edits one, and never guesses on a partial match.
 */
export function linkRecipientByAccount(ctx: Ctx, ownerId: string, invoiceId: string): void {
  if (ctx.config.appMode !== "live") return;
  const inv = ctx.db.prepare("SELECT beneficiary_account, recipient_registry_id FROM invoices WHERE id = ? AND owner_user_id = ?").get(invoiceId, ownerId) as
    | { beneficiary_account: string; recipient_registry_id: string } | undefined;
  if (!inv || !inv.beneficiary_account.trim()) return;
  const matches = ctx.db.prepare("SELECT registry_id FROM trusted_recipients WHERE owner_user_id = ? AND REPLACE(UPPER(account), ' ', '') = ?").all(ownerId, normAcct(inv.beneficiary_account)) as { registry_id: string }[];
  if (matches.length === 1 && matches[0].registry_id !== inv.recipient_registry_id) {
    ctx.db.prepare("UPDATE invoices SET recipient_registry_id = ? WHERE id = ? AND owner_user_id = ?").run(matches[0].registry_id, invoiceId, ownerId);
  }
}
