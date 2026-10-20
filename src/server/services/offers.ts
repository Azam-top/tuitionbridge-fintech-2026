// Where payment options come from in the live mode. Every option carries its provenance, source note and observation time:
//   PROVIDER_LIVE  : fetched from a provider's API (currently the Wise public quote endpoint)
//   USER_DECLARED  : typed in by the user from a bank or provider, with a source note and the time they saw it
// Nothing is invented. If a source is unavailable the option is simply absent.
import { z } from "zod";
import type { Ctx } from "../ctx.js";
import { httpFetch } from "../ctx.js";
import { newId } from "../ids.js";
import { PolicyError } from "../errors.js";
import { decimalToMinor, exactDecimalToMinor, parseRate } from "../../shared/money.js";
import type { QuoteRecord } from "../../shared/policy.js";
import { audit } from "./audit.js";
import { getInvoice, parseInput } from "./invoices.js";
import { latestQuotesForInvoice } from "./quotes.js";
import { deviationBps, latestReference } from "./reference-rate.js";

const WIDE_MIN = "1";
const WIDE_MAX = "999999999999999"; // provider limits are not declared by these sources

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "provider";

interface NewQuote {
  providerId: string; providerName: string; rate: string; feeCents: string; expiresAt: string; estArrivalAt: string;
  provenance: "USER_DECLARED" | "PROVIDER_LIVE"; sourceNote: string; observedAt: string; externalRef: string | null;
  /** PROVIDER_LIVE: the provider's exact debit and credit for this option. */
  providerAmounts?: { sourceTotalCents: string; targetTiyn: string };
}

function insertQuote(ctx: Ctx, ownerId: string, invoiceId: string, q: NewQuote): QuoteRecord {
  const prev = ctx.db.prepare("SELECT COALESCE(MAX(version),0) v FROM quotes WHERE owner_user_id=? AND invoice_id=? AND provider_id=?").get(ownerId, invoiceId, q.providerId) as { v: number };
  const id = newId("q");
  ctx.db.prepare(
    `INSERT INTO quotes (id, owner_user_id, invoice_id, provider_id, provider_name, version, src_ccy, dst_ccy, rate, fee_cents, min_kzt_tiyn, max_kzt_tiyn,
       issued_at, expires_at, est_arrival_at, eligible, ineligible_reason, provenance, source_note, observed_at, external_ref,
       provider_source_cents, provider_target_tiyn)
     VALUES (?,?,?,?,?,?,'USD','KZT',?,?,?,?,?,?,?,1,NULL,?,?,?,?,?,?)`,
  ).run(id, ownerId, invoiceId, q.providerId, q.providerName, prev.v + 1, q.rate, q.feeCents, WIDE_MIN, WIDE_MAX, ctx.clock.now().toISOString(), q.expiresAt, q.estArrivalAt, q.provenance, q.sourceNote, q.observedAt, q.externalRef,
    q.providerAmounts?.sourceTotalCents ?? null, q.providerAmounts?.targetTiyn ?? null);
  return latestQuotesForInvoice(ctx, ownerId, invoiceId).find((x) => x.id === id)!;
}

// ------------------------------------------------------------------ user-declared offers
const iso = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "invalid timestamp");
const ManualOffer = z.object({
  invoiceId: z.string().max(64),
  providerName: z.string().trim().min(2).max(80),
  rate: z.string().trim().max(16),
  feeUsd: z.string().trim().max(16),
  arrivalAt: iso,
  validUntil: iso,
  observedAt: iso,
  sourceNote: z.string().trim().min(3, "Say where you got this offer (for example: Bank app quote screen).").max(300),
}).strict();

/** Rates further than this from the NBK reference are rejected as probable typos (the reference is a guide, not a price). */
export const MAX_REFERENCE_DEVIATION_BPS = 2500;

export function addManualOffer(ctx: Ctx, ownerId: string, raw: unknown): QuoteRecord {
  if (ctx.config.appMode !== "live") throw new PolicyError("WRONG_MODE", "Manual offers exist only in the live mode; the sandbox issues labeled test quotes.");
  const v = parseInput(ManualOffer, raw);
  const inv = getInvoice(ctx, ownerId, v.invoiceId);
  if (inv.status !== "CONFIRMED") throw new PolicyError("INVOICE_NOT_CONFIRMED", "Confirm the invoice before adding offers for it.");
  let fee: bigint;
  try { parseRate(v.rate); fee = decimalToMinor(v.feeUsd, "Fee"); }
  catch (e) { throw new PolicyError("VALIDATION", e instanceof Error ? e.message : "Invalid rate or fee."); }
  const now = ctx.clock.now().getTime();
  const arrival = Date.parse(v.arrivalAt); const valid = Date.parse(v.validUntil); const seen = Date.parse(v.observedAt);
  if (valid <= now) throw new PolicyError("VALIDATION", "This offer's validity time has already passed. Get a current offer.");
  if (valid > now + 7 * 86_400_000) throw new PolicyError("VALIDATION", "Offers valid for more than 7 days are not accepted; re-check the offer closer to payment.");
  if (arrival <= now) throw new PolicyError("VALIDATION", "The estimated arrival must be in the future.");
  if (seen > now + 60_000) throw new PolicyError("VALIDATION", "The time you saw this offer cannot be in the future.");
  if (seen < now - 7 * 86_400_000) throw new PolicyError("VALIDATION", "The offer was seen more than 7 days ago; re-check it.");
  const ref = latestReference(ctx);
  if (ref && Math.abs(deviationBps(v.rate, ref)) > MAX_REFERENCE_DEVIATION_BPS) {
    throw new PolicyError("VALIDATION", `A rate of ${v.rate} KZT per USD is more than 25% away from the official NBK reference (${ref.rate}). Check the number for a typo.`);
  }
  const q = insertQuote(ctx, ownerId, v.invoiceId, {
    providerId: `user:${slug(v.providerName)}`, providerName: `${v.providerName} (offer entered by you)`, rate: v.rate.trim(), feeCents: fee.toString(),
    expiresAt: new Date(valid).toISOString(), estArrivalAt: new Date(arrival).toISOString(), provenance: "USER_DECLARED",
    sourceNote: v.sourceNote, observedAt: new Date(seen).toISOString(), externalRef: null,
  });
  audit(ctx.db, ctx.clock, { ownerUserId: ownerId, event: "offer.declared", result: "INFO", refs: { invoiceId: v.invoiceId, quoteId: q.id } });
  return q;
}

// ------------------------------------------------------------------ Wise public quote endpoint
export const WISE_QUOTE_URL_DEFAULT = "https://api.wise.com/2026Q4/quotes";
const WISE_PAYINS: Record<string, string> = { BANK_TRANSFER: "bank transfer", DEBIT: "debit card", CREDIT: "credit card" };

/** Money fields that must keep the exact decimal text the provider sent (read through the JSON source text, never through a float). */
const WISE_EXACT_KEYS = new Set(["sourceAmount", "targetAmount", "total", "rate"]);

/** Parses a Wise response body. Amount fields stay exact decimal strings when the runtime exposes the JSON source text. */
export function parseWiseBody(text: string): unknown {
  return JSON.parse(text, function (this: unknown, key: string, value: unknown, ctx?: { source?: string }) {
    return WISE_EXACT_KEYS.has(key) && typeof value === "number" && typeof ctx?.source === "string" ? ctx.source : value;
  } as Parameters<typeof JSON.parse>[1]);
}

type Dec = number | string;
interface WiseOption {
  payIn?: string; payOut?: string; disabled?: boolean; sourceAmount?: Dec; targetAmount?: Dec; estimatedDelivery?: string;
  sourceCurrency?: string; targetCurrency?: string;
  fee?: { total?: Dec }; price?: { priceDecisionReferenceId?: string };
}
interface WiseQuote {
  rate?: Dec; rateType?: string; createdTime?: string; expirationTime?: string; guaranteedTargetAmount?: boolean;
  sourceCurrency?: string; targetCurrency?: string; paymentOptions?: WiseOption[];
}

/**
 * Pure: turns a Wise unauthenticated quote response into option drafts. For each usable option the provider's OWN amounts are stored
 * exactly: total debit (`sourceAmount`), recipient amount (`targetAmount`) and fee (`fee.total`), converted from decimal to minor
 * units without floating-point arithmetic. Nothing is rebuilt from the rate, no fee or rate is adjusted and no tolerance is applied:
 * the rate Wise displays is rounded and is kept only for display. An option is dropped when its currencies are wrong, it is
 * disabled, a money field is not an exact decimal amount, or the total does not exceed the fee. Whether the recipient amount covers
 * the invoice is judged later by the policy, so the user sees such an option excluded with its reason.
 */
export function parseWiseQuote(json: unknown, _tuitionTiyn?: bigint): NewQuote[] {
  const q = json as WiseQuote;
  if (!q || !Array.isArray(q.paymentOptions) || !q.expirationTime || !q.createdTime) return [];
  if (Number.isNaN(Date.parse(q.expirationTime)) || Number.isNaN(Date.parse(q.createdTime))) return [];
  if ((q.sourceCurrency ?? "USD") !== "USD" || (q.targetCurrency ?? "KZT") !== "KZT") return [];
  const rate = typeof q.rate === "number" ? String(q.rate) : typeof q.rate === "string" ? q.rate : "";
  try { parseRate(rate); } catch { return []; } // the displayed rate must be a plain decimal; no rate is ever invented
  const out: NewQuote[] = [];
  for (const o of q.paymentOptions) {
    if (!o.payIn || !(o.payIn in WISE_PAYINS) || o.payOut !== "BANK_TRANSFER" || o.disabled) continue;
    if ((o.sourceCurrency ?? "USD") !== "USD" || (o.targetCurrency ?? "KZT") !== "KZT") continue;
    if (typeof o.estimatedDelivery !== "string" || Number.isNaN(Date.parse(o.estimatedDelivery))) continue;
    let fee: bigint; let source: bigint; let target: bigint;
    try {
      fee = exactDecimalToMinor(o.fee?.total, "Wise fee", true);
      source = exactDecimalToMinor(o.sourceAmount, "Wise total");
      target = exactDecimalToMinor(o.targetAmount, "Wise recipient amount");
    } catch { continue; }
    if (source <= fee) continue;
    out.push({
      providerId: `wise:${o.payIn}`, providerName: `Wise (pay by ${WISE_PAYINS[o.payIn]})`, rate, feeCents: fee.toString(),
      expiresAt: q.expirationTime, estArrivalAt: o.estimatedDelivery, provenance: "PROVIDER_LIVE", observedAt: q.createdTime,
      externalRef: `wise-price:${o.price?.priceDecisionReferenceId ?? "n/a"}`,
      providerAmounts: { sourceTotalCents: source.toString(), targetTiyn: target.toString() },
      sourceNote: `Wise public quote API (unauthenticated), rate type ${q.rateType ?? "unknown"}. Total, fee and recipient amount are exactly as Wise quoted them; the rate shown is Wise's displayed (rounded) rate. The received KZT amount is ${q.guaranteedTargetAmount ? "" : "not "}guaranteed; delivery time is Wise's estimate.`,
    });
  }
  return out;
}

/** KZT per USD implied by a quoted option, as a plain 6-decimal text, for the plausibility check only (never for amounts). */
export function impliedRate(principalCents: bigint, targetTiyn: bigint): string {
  const scaled = (targetTiyn * 1_000_000n) / principalCents; // floor, 6 decimals
  const whole = scaled / 1_000_000n; const frac = (scaled % 1_000_000n).toString().padStart(6, "0");
  return `${whole}.${frac}`;
}

export interface RefreshResult { status: "OK" | "DISABLED" | "UNAVAILABLE" | "NO_ROUTE"; stored: number; message: string }

export type WiseFetch = { kind: "ok"; json: unknown } | { kind: "no_route" } | { kind: "unavailable" };

/**
 * The only outbound call to Wise. Only the currencies and the tuition amount are sent: no name, account, email or invoice
 * text leaves the machine. Never called inside a database transaction.
 */
export async function fetchWiseJson(ctx: Ctx, tuitionTiyn: bigint): Promise<WiseFetch> {
  const body = { sourceCurrency: "USD", targetCurrency: "KZT", sourceAmount: null, targetAmount: Number(tuitionTiyn) / 100 };
  try {
    const res = await httpFetch(ctx)(process.env.APP_WISE_QUOTE_URL?.trim() || WISE_QUOTE_URL_DEFAULT, {
      method: "POST", headers: { "content-type": "application/json", "x-external-correlation-id": newId("corr") }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 400 || res.status === 422) return { kind: "no_route" };
    if (!res.ok) return { kind: "unavailable" };
    return { kind: "ok", json: parseWiseBody(await res.text()) };
  } catch {
    return { kind: "unavailable" };
  }
}

/** Failure stores nothing; there is no substitute offer. */
export async function refreshProviderOffers(ctx: Ctx, ownerId: string, invoiceId: string): Promise<RefreshResult> {
  if (!ctx.config.wiseQuotes) return { status: "DISABLED", stored: 0, message: "Live Wise quotes are switched off (APP_WISE_QUOTES=1 enables them)." };
  const inv = getInvoice(ctx, ownerId, invoiceId);
  if (inv.status !== "CONFIRMED") throw new PolicyError("INVOICE_NOT_CONFIRMED", "Confirm the invoice before fetching quotes.");
  const tuition = BigInt(inv.amount_kzt_tiyn);
  const got = await fetchWiseJson(ctx, tuition);
  if (got.kind === "unavailable") return { status: "UNAVAILABLE", stored: 0, message: "Wise could not be reached. No quote was stored; enter an offer by hand or retry." };
  if (got.kind === "no_route") return { status: "NO_ROUTE", stored: 0, message: "Wise did not return a USD to KZT quote for this amount." };
  // Plausibility only (not a tolerance on amounts): a quote whose implied rate is far from the official NBK reference is a malformed response.
  const ref = latestReference(ctx);
  const drafts = parseWiseQuote(got.json, tuition).filter((d) => {
    if (!ref || !d.providerAmounts) return true;
    const principal = BigInt(d.providerAmounts.sourceTotalCents) - BigInt(d.feeCents);
    return Math.abs(deviationBps(impliedRate(principal, BigInt(d.providerAmounts.targetTiyn)), ref)) <= MAX_REFERENCE_DEVIATION_BPS;
  });
  if (!drafts.length) return { status: "NO_ROUTE", stored: 0, message: "Wise returned no usable USD to KZT option for this amount." };
  ctx.db.transaction(() => { for (const d of drafts) insertQuote(ctx, ownerId, invoiceId, d); })();
  audit(ctx.db, ctx.clock, { ownerUserId: ownerId, event: "offers.provider_fetched", result: "INFO", refs: { invoiceId, provider: "wise", count: drafts.length } });
  return { status: "OK", stored: drafts.length, message: `Fetched ${drafts.length} Wise option(s).` };
}

export interface OfferView {
  id: string; providerName: string; provenance: string; rate: string; feeCents: string; expiresAt: string; estArrivalAt: string;
  observedAt: string | null; sourceNote: string | null; expired: boolean; deviationBps: number | null;
}

/** Current (highest-version) offers per provider for an invoice, as shown to the user. */
export function listOffers(ctx: Ctx, ownerId: string, invoiceId: string): OfferView[] {
  const ref = latestReference(ctx);
  const now = ctx.clock.now().getTime();
  return latestQuotesForInvoice(ctx, ownerId, invoiceId).map((q) => ({
    id: q.id, providerName: q.providerName, provenance: q.provenance, rate: q.rate, feeCents: q.feeCents, expiresAt: q.expiresAt, estArrivalAt: q.estArrivalAt,
    observedAt: q.observedAt ?? null, sourceNote: q.sourceNote ?? null, expired: Date.parse(q.expiresAt) <= now, deviationBps: ref ? deviationBps(q.rate, ref) : null,
  }));
}
