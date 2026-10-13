import type { Ctx } from "../ctx.js";
import { newId } from "../ids.js";
import { PolicyError } from "../errors.js";
import { MAX_KZT_TIYN, MIN_KZT_TIYN, PROVIDERS, type ScenarioId } from "../fixtures.js";
import type { QuoteRecord } from "../../shared/policy.js";
import { getInvoice } from "./invoices.js";
import { audit } from "./audit.js";

interface QuoteRow {
  id: string; owner_user_id: string; invoice_id: string; provider_id: string; provider_name: string; version: number;
  src_ccy: string; dst_ccy: string; rate: string; fee_cents: string; min_kzt_tiyn: string; max_kzt_tiyn: string;
  issued_at: string; expires_at: string; est_arrival_at: string; eligible: number; ineligible_reason: string | null; provenance: string;
}

export const rowToQuote = (r: QuoteRow): QuoteRecord => ({
  id: r.id, providerId: r.provider_id, providerName: r.provider_name, version: r.version, srcCcy: r.src_ccy, dstCcy: r.dst_ccy,
  rate: r.rate, feeCents: r.fee_cents, minKztTiyn: r.min_kzt_tiyn, maxKztTiyn: r.max_kzt_tiyn, issuedAt: r.issued_at,
  expiresAt: r.expires_at, estArrivalAt: r.est_arrival_at, eligible: r.eligible === 1, ineligibleReason: r.ineligible_reason,
  provenance: r.provenance,
});

export function getQuote(ctx: Ctx, ownerId: string, quoteId: string): QuoteRecord {
  const r = ctx.db.prepare("SELECT * FROM quotes WHERE id = ? AND owner_user_id = ?").get(quoteId, ownerId) as QuoteRow | undefined;
  if (!r) throw new PolicyError("NOT_FOUND", "Quote not found.");
  return rowToQuote(r);
}

/**
 * Issues a fresh set of SIMULATED quotes for a confirmed invoice. Arrival times are estimates, not guarantees.
 * Each call creates a new quote version per provider; older versions are never reused implicitly.
 */
export function issueQuotes(ctx: Ctx, ownerId: string, invoiceId: string): QuoteRecord[] {
  const inv = getInvoice(ctx, ownerId, invoiceId);
  if (inv.status === "PAID") throw new PolicyError("INVOICE_ALREADY_PAID", "Invoice is already paid.");
  if (inv.status !== "CONFIRMED") throw new PolicyError("INVOICE_NOT_CONFIRMED", "The invoice must be confirmed by the student before quotes are requested.");
  const scenario = (ctx.db.prepare("SELECT scenario FROM users WHERE id = ?").get(ownerId) as { scenario: ScenarioId }).scenario;
  const now = ctx.clock.now();
  const out: QuoteRecord[] = [];
  ctx.db.transaction(() => {
    for (const p of PROVIDERS) {
      const prev = ctx.db.prepare("SELECT COALESCE(MAX(version),0) v FROM quotes WHERE owner_user_id=? AND invoice_id=? AND provider_id=?").get(ownerId, invoiceId, p.id) as { v: number };
      const hours = scenario === "all_late" ? p.lateArrivalHours : p.arrivalHours;
      const q: QuoteRecord = {
        id: newId("q"), providerId: p.id, providerName: p.name, version: prev.v + 1, srcCcy: "USD", dstCcy: "KZT",
        rate: p.rate, feeCents: p.feeCents, minKztTiyn: MIN_KZT_TIYN, maxKztTiyn: MAX_KZT_TIYN,
        issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + ctx.config.quoteTtlMs).toISOString(),
        estArrivalAt: new Date(now.getTime() + hours * 3600_000).toISOString(), eligible: true, ineligibleReason: null,
        provenance: "SIMULATED",
      };
      ctx.db.prepare(
        `INSERT INTO quotes (id, owner_user_id, invoice_id, provider_id, provider_name, version, src_ccy, dst_ccy, rate, fee_cents,
           min_kzt_tiyn, max_kzt_tiyn, issued_at, expires_at, est_arrival_at, eligible, ineligible_reason, provenance)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(q.id, ownerId, invoiceId, q.providerId, q.providerName, q.version, q.srcCcy, q.dstCcy, q.rate, q.feeCents,
        q.minKztTiyn, q.maxKztTiyn, q.issuedAt, q.expiresAt, q.estArrivalAt, 1, null, q.provenance);
      out.push(q);
    }
  })();
  audit(ctx.db, ctx.clock, { ownerUserId: ownerId, event: "quotes.issued", result: "INFO", refs: { invoiceId, count: out.length } });
  return out;
}
