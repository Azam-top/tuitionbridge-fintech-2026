// Pure route/quote policy. No I/O, no clock reads: `now` is always passed in.

import { MoneyError, parseMinor, parseRate, recipientTiyn, senderPrincipalCents } from "./money.js";

export type ExclusionCode =
  | "UNSUPPORTED_PAIR"
  | "NOT_ELIGIBLE"
  | "EXPIRED"
  | "AMOUNT_OUT_OF_RANGE"
  | "LATE"
  | "INSUFFICIENT_FUNDS"
  | "RESERVE_BREACH"
  | "INVALID_QUOTE";

export interface QuoteRecord {
  id: string;
  providerId: string;
  providerName: string;
  version: number;
  srcCcy: string;
  dstCcy: string;
  rate: string; // KZT per USD, decimal string
  feeCents: string; // fixed USD sender fee
  minKztTiyn: string;
  maxKztTiyn: string;
  issuedAt: string; // ISO
  expiresAt: string; // ISO
  estArrivalAt: string; // ISO (estimate, not a guarantee)
  eligible: boolean;
  ineligibleReason: string | null;
  provenance: string; // always "SIMULATED"
}

export interface RouteEvaluation {
  quoteId: string;
  providerId: string;
  providerName: string;
  version: number;
  rate: string;
  feeCents: string;
  principalCents: string;
  totalDebitCents: string;
  recipientTiyn: string;
  surplusTiyn: string;
  estArrivalAt: string;
  expiresAt: string;
  usdAfterCents: string;
  feasible: boolean;
  exclusions: { code: ExclusionCode; message: string }[];
}

export type Preference = "cheapest" | "fastest";

export interface EvaluateInput {
  quotes: QuoteRecord[];
  tuitionTiyn: bigint;
  deadlineAt: string;
  now: string;
  usdBalanceCents: bigint;
  usdReserveCents: bigint;
  preference: Preference;
}

export interface EvaluateResult {
  routes: RouteEvaluation[]; // feasible first (ranked), then excluded in stable order
  best: RouteEvaluation | null;
}

const ms = (iso: string): number => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new MoneyError(`invalid timestamp ${iso}`);
  return t;
};

export function evaluateQuote(q: QuoteRecord, i: Omit<EvaluateInput, "quotes" | "preference">): RouteEvaluation {
  const exclusions: RouteEvaluation["exclusions"] = [];
  let principal = 0n;
  let fee = 0n;
  let recipient = 0n;
  let total = 0n;
  try {
    const rate = parseRate(q.rate);
    fee = parseMinor(q.feeCents, "fee");
    principal = senderPrincipalCents(i.tuitionTiyn, rate);
    total = principal + fee;
    recipient = recipientTiyn(principal, rate);
    if (recipient < i.tuitionTiyn) throw new MoneyError("recipient amount would not cover tuition");
    if (i.tuitionTiyn < parseMinor(q.minKztTiyn) || i.tuitionTiyn > parseMinor(q.maxKztTiyn)) {
      exclusions.push({ code: "AMOUNT_OUT_OF_RANGE", message: "Tuition amount is outside this provider's allowed range." });
    }
  } catch (e) {
    exclusions.push({ code: "INVALID_QUOTE", message: e instanceof Error ? e.message : "invalid quote" });
  }
  if (q.srcCcy !== "USD" || q.dstCcy !== "KZT") {
    exclusions.push({ code: "UNSUPPORTED_PAIR", message: `Unsupported currency pair ${q.srcCcy}->${q.dstCcy}; only USD->KZT is supported.` });
  }
  if (!q.eligible) {
    exclusions.push({ code: "NOT_ELIGIBLE", message: q.ineligibleReason ?? "Provider marked this route ineligible." });
  }
  if (ms(q.expiresAt) <= ms(i.now)) {
    exclusions.push({ code: "EXPIRED", message: "Quote has expired." });
  }
  if (ms(q.estArrivalAt) > ms(i.deadlineAt)) {
    exclusions.push({ code: "LATE", message: "Estimated arrival is after the confirmed deadline." });
  }
  if (total > i.usdBalanceCents) {
    exclusions.push({ code: "INSUFFICIENT_FUNDS", message: "Total debit exceeds the USD balance." });
  } else if (i.usdBalanceCents - total < i.usdReserveCents) {
    exclusions.push({ code: "RESERVE_BREACH", message: "Paying this route would drop USD below the living-expense reserve." });
  }
  const usdAfter = i.usdBalanceCents - total;
  return {
    quoteId: q.id,
    providerId: q.providerId,
    providerName: q.providerName,
    version: q.version,
    rate: q.rate,
    feeCents: fee.toString(),
    principalCents: principal.toString(),
    totalDebitCents: total.toString(),
    recipientTiyn: recipient.toString(),
    surplusTiyn: (recipient - i.tuitionTiyn).toString(),
    estArrivalAt: q.estArrivalAt,
    expiresAt: q.expiresAt,
    usdAfterCents: usdAfter.toString(),
    feasible: exclusions.length === 0,
    exclusions,
  };
}

function cmp(a: bigint | number, b: bigint | number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Deterministic ranking.
 * cheapest: total debit, then earliest arrival, then lowest fee, then quote id.
 * fastest: earliest arrival, then total debit, then lowest fee, then quote id.
 */
export function evaluateRoutes(input: EvaluateInput): EvaluateResult {
  const evaluated = input.quotes.map((q) => evaluateQuote(q, input));
  const feasible = evaluated.filter((r) => r.feasible);
  const excluded = evaluated.filter((r) => !r.feasible).sort((a, b) => a.quoteId.localeCompare(b.quoteId));
  feasible.sort((a, b) => {
    const debit = cmp(BigInt(a.totalDebitCents), BigInt(b.totalDebitCents));
    const arrival = cmp(ms(a.estArrivalAt), ms(b.estArrivalAt));
    const fee = cmp(BigInt(a.feeCents), BigInt(b.feeCents));
    const order = input.preference === "cheapest" ? [debit, arrival, fee] : [arrival, debit, fee];
    for (const o of order) if (o !== 0) return o;
    return a.quoteId.localeCompare(b.quoteId);
  });
  return { routes: [...feasible, ...excluded], best: feasible[0] ?? null };
}
