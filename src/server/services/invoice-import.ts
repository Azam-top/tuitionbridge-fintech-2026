// Text and text-PDF invoice import. Deliberately conservative:
// - extracted values are only a DRAFT for the student to review and confirm (never auto-confirmed),
// - ambiguity (conflicting values, non-KZT amounts, date without time, day/month order) is flagged, never guessed,
// - missing bank details stay empty: nothing is filled in from the trusted registry or from the model,
// - scanned/image PDFs (no text layer) are rejected; OCR is out of scope.

import type { Ctx } from "../ctx.js";
import { newId } from "../ids.js";
import { PolicyError } from "../errors.js";
import { audit } from "./audit.js";
import { toView, type InvoiceView, getInvoice } from "./invoices.js";

export const MAX_TEXT_CHARS = 20_000;
export const MAX_PDF_BYTES = 300 * 1024;
const MAX_PDF_PAGES = 5;

export interface ParsedInvoice {
  reference: string;
  recipientRegistryId: string;
  beneficiaryName: string;
  beneficiaryAccount: string;
  amountKztTiyn: string;
  dueAt: string; // ISO or ""
  ambiguousFields: string[];
  missingFields: string[];
}

const uniq = (a: string[]) => [...new Set(a)];

function toTiyn(raw: string): string | null {
  const t = raw.replace(/[\s,]/g, "");
  const m = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  return (BigInt(m[1]) * 100n + BigInt((m[2] ?? "").padEnd(2, "0") || "0")).toString();
}

export function parseInvoiceText(textIn: string): ParsedInvoice {
  const text = textIn.replace(/\r/g, "").slice(0, MAX_TEXT_CHARS);
  const ambiguous: string[] = [];
  const missing: string[] = [];

  const collect = (re: RegExp, group = 1): string[] => uniq([...text.matchAll(re)].map((m) => m[group].trim()).filter(Boolean));

  // reference
  const refs = collect(/(?:invoice\s*(?:no\.?|number|#|ref(?:erence)?)|reference)\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/]{2,40})/gi);
  let reference = "";
  if (refs.length === 1) reference = refs[0];
  else if (refs.length > 1) { ambiguous.push("reference"); reference = refs[0]; }
  else missing.push("reference");

  // registry id
  const regs = collect(/(?:registry\s*id|recipient\s*id)\s*[:\-]?\s*([A-Z]{2,5}-[A-Z]{2,5}-\d{3})/gi);
  let recipientRegistryId = "";
  if (regs.length === 1) recipientRegistryId = regs[0];
  else if (regs.length > 1) { ambiguous.push("recipientRegistryId"); recipientRegistryId = regs[0]; }
  else missing.push("recipientRegistryId");

  // beneficiary name
  const names = collect(/(?:beneficiary|payee|recipient)(?:\s*name)?\s*[:\-]\s*([^\n]{3,200})/gi);
  let beneficiaryName = "";
  if (names.length === 1) beneficiaryName = names[0];
  else if (names.length > 1) { ambiguous.push("beneficiaryName"); beneficiaryName = names[0]; }
  else missing.push("beneficiaryName");

  // account (KZ IBAN-like)
  const accts = collect(/(?:account|iban)(?:\s*(?:no\.?|number))?\s*[:\-]?\s*(KZ[0-9A-Z]{10,30})/gi);
  let beneficiaryAccount = "";
  if (accts.length === 1) beneficiaryAccount = accts[0];
  else if (accts.length > 1) { ambiguous.push("beneficiaryAccount"); beneficiaryAccount = accts[0]; }
  else missing.push("beneficiaryAccount");

  // amount: must be labeled and in KZT; a different currency or conflicting values are ambiguous
  const amountRe = /(?:amount\s*due|total\s*due|amount\s*payable|total\s*amount|tuition\s*fee)\s*[:\-]?\s*([A-Z]{3}|₸|тг)?\s*([\d][\d,\s]*(?:\.\d{1,2})?)\s*([A-Z]{3}|₸|тг)?/gi;
  const amounts: { tiyn: string; ccy: string }[] = [];
  for (const m of text.matchAll(amountRe)) {
    const ccy = (m[1] ?? m[3] ?? "").toUpperCase();
    const tiyn = toTiyn(m[2]);
    if (tiyn) amounts.push({ tiyn, ccy: ccy === "₸" || ccy === "ТГ" ? "KZT" : ccy });
  }
  let amountKztTiyn = "";
  const distinct = uniq(amounts.map((a) => a.tiyn));
  if (!amounts.length) missing.push("amountKztTiyn");
  else {
    amountKztTiyn = amounts[0].tiyn;
    if (distinct.length > 1 || amounts.some((a) => a.ccy !== "KZT")) ambiguous.push("amountKztTiyn");
  }

  // due date: ISO only. A date without a time or a day/month-ambiguous date is never guessed.
  let dueAt = "";
  const dueMatches = [...text.matchAll(/(?:due\s*date|pay\s*by|payment\s*due|deadline)\s*[:\-]?\s*(\d{4}-\d{2}-\d{2})(?:[T\s]+(\d{2}:\d{2})(?::\d{2})?\s*(Z|[+-]\d{2}:?\d{2})?)?/gi)];
  const slashy = /(?:due\s*date|pay\s*by|payment\s*due|deadline)\s*[:\-]?\s*\d{1,2}[/.]\d{1,2}[/.]\d{2,4}/i.test(text);
  if (dueMatches.length === 0) {
    missing.push("dueAt");
    if (slashy) ambiguous.push("dueAt");
  } else {
    const keys = uniq(dueMatches.map((m) => `${m[1]}T${m[2] ?? ""}${m[3] ?? ""}`));
    const m = dueMatches[0];
    const hasTime = !!m[2];
    const tz = m[3] ? (m[3] === "Z" ? "Z" : m[3].replace(/^([+-]\d{2})(\d{2})$/, "$1:$2")) : "";
    const d = new Date(hasTime ? `${m[1]}T${m[2]}:00${tz || "Z"}` : `${m[1]}T23:59:00Z`);
    if (!Number.isNaN(d.getTime())) dueAt = d.toISOString();
    if (keys.length > 1 || !hasTime || !tz || slashy) ambiguous.push("dueAt"); // suggested value is prefilled but must be re-entered
  }

  return {
    reference, recipientRegistryId, beneficiaryName, beneficiaryAccount, amountKztTiyn, dueAt,
    ambiguousFields: uniq(ambiguous), missingFields: uniq(missing),
  };
}

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  if (bytes.length === 0 || bytes.length > MAX_PDF_BYTES) throw new PolicyError("VALIDATION", `PDF must be between 1 byte and ${MAX_PDF_BYTES / 1024} KB.`);
  if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") throw new PolicyError("VALIDATION", "That file is not a PDF.");
  const fail = () => new PolicyError("VALIDATION", "Could not read text from this PDF. Scanned or image-only PDFs are not supported (no OCR); enter the details manually.");
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false, verbosity: 0 });
    const doc = await Promise.race([
      task.promise,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000)),
    ]);
    let out = "";
    const pages = Math.min(doc.numPages, MAX_PDF_PAGES);
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if ("str" in item) out += item.str + ("hasEOL" in item && item.hasEOL ? "\n" : " ");
      }
      out += "\n";
    }
    await task.destroy();
    if (out.replace(/\s/g, "").length < 20) throw fail();
    return out.slice(0, MAX_TEXT_CHARS);
  } catch (e) {
    if (e instanceof PolicyError) throw e;
    throw fail();
  }
}

/** Creates a DRAFT invoice from extracted text. Never confirms; never consults the trusted registry to fill gaps. */
export function importInvoiceFromText(ctx: Ctx, ownerId: string, text: string, sourceType: "structured" | "text_pdf"): InvoiceView {
  if (!text.trim()) throw new PolicyError("VALIDATION", "Nothing to import.");
  if (text.length > MAX_TEXT_CHARS) throw new PolicyError("VALIDATION", `Text is longer than ${MAX_TEXT_CHARS} characters.`);
  const p = parseInvoiceText(text);
  const id = newId("inv");
  let reference = p.reference;
  const flagged = [...p.ambiguousFields];
  const exists = (r: string) => !!ctx.db.prepare("SELECT 1 FROM invoices WHERE owner_user_id = ? AND reference = ?").get(ownerId, r);
  if (!reference || exists(reference)) {
    reference = `IMPORT-${id.slice(-6).toUpperCase()}`;
    flagged.push("reference");
  }
  ctx.db.prepare(
    `INSERT INTO invoices (id, owner_user_id, reference, recipient_registry_id, beneficiary_name, beneficiary_account,
       amount_kzt_tiyn, due_at, source_type, notes, ambiguous_fields, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,'DRAFT',?)`,
  ).run(id, ownerId, reference, p.recipientRegistryId, p.beneficiaryName, p.beneficiaryAccount, p.amountKztTiyn, p.dueAt,
    sourceType, text.slice(0, 2000), JSON.stringify([...new Set(flagged)]), ctx.clock.now().toISOString());
  audit(ctx.db, ctx.clock, {
    ownerUserId: ownerId, event: "invoice.imported", result: "INFO",
    refs: { invoiceId: id, source: sourceType, ambiguous: p.ambiguousFields.join(","), missing: p.missingFields.join(",") },
  });
  return toView(getInvoice(ctx, ownerId, id));
}
