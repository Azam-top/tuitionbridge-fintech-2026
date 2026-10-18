// Narrative grounding: model prose is only shown when it makes no financial claim that the backend records
// do not support. Every figure the UI presents as a fact (amounts, route, payment status) comes from stored
// proposals/receipts; the model's sentences are commentary at most, and are withheld when they disagree.

import type { Preference } from "../../shared/policy.js";

export interface GroundingFacts {
  /** Canonical numbers present in trusted records (tool outputs, proposal, receipt, the student's own instruction). */
  numbers: Set<string>;
  paymentExists: boolean;
  approvalExists: boolean;
  /** Objective of the current proposal, if one exists. */
  proposalPreference: Preference | null;
}

export interface GroundingResult {
  ok: boolean;
  reasons: string[];
}

const NUMBER_RE = /\d[\d,]*(?:\.\d+)?/g;
const CURRENCY_NEAR = /(?:usd|kzt|eur|rub|[$€£₸]|dollars?|tenge|долл|тенге|евро)/i;
/** Keys whose values are untrusted document text; their numbers never count as backend facts. */
const UNTRUSTED_KEYS = new Set(["untrustedNotes", "notesWarning"]);

export function canonicalNumber(raw: string): string {
  let s = raw.replace(/,/g, "");
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s;
}

function addNumbersFromString(s: string, into: Set<string>): void {
  for (const m of s.matchAll(NUMBER_RE)) {
    const c = canonicalNumber(m[0]);
    into.add(c);
    // Minor-unit integers (cents/tiyn) also support their major-unit rendering.
    if (/^\d{3,18}$/.test(c)) {
      const n = BigInt(c);
      into.add(canonicalNumber(`${n / 100n}.${(n % 100n).toString().padStart(2, "0")}`));
    }
  }
}

/** Collects numbers from a trusted JSON-like value, skipping untrusted document fields. */
export function collectNumbers(value: unknown, into: Set<string>): void {
  if (value === null || value === undefined) return;
  if (typeof value === "string") addNumbersFromString(value, into);
  else if (typeof value === "number" || typeof value === "bigint") addNumbersFromString(String(value), into);
  else if (Array.isArray(value)) for (const v of value) collectNumbers(v, into);
  else if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (!UNTRUSTED_KEYS.has(k)) collectNumbers(v, into);
  }
}

// A sentence that is negated, future, conditional or an instruction does not assert that something happened.
const NON_ASSERTIVE = /\b(will|would|won't|not|no|nothing|never|until|before|once|if|pending|awaiting|await|cannot|can't|unless|should|must|need|needs|requires?|required|please|after you|when you|can be|could|may)\b|\bn't\b|не\s|нет|ничего|будет|будут|после|если|ожида|нужно|необходимо|пожалуйста/i;
const PAID_CLAIM = /\b(paid|payment (?:was |has been )?(?:made|sent|completed|executed|successful|processed)|has been (?:paid|sent|transferred|debited|credited)|was (?:sent|transferred|debited|credited|received)|(?:sent|transferred|debited|credited|received|settled)\b|completed|executed|success(?:ful|fully))|оплачен|переведен|отправлен|списан|зачислен|выполнен/i;
const APPROVED_CLAIM = /\bapproved\b|одобрен|подтвержд[её]н/i;
const CHEAPEST_CLAIM = /\b(cheapest|lowest[- ](?:cost|fee|price)|least expensive)\b|самый дешёвый|самый дешевый/i;
const FASTEST_CLAIM = /\b(fastest|quickest|earliest arrival)\b|самый быстрый/i;

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

export function checkNarrative(text: string, facts: GroundingFacts): GroundingResult {
  const reasons = new Set<string>();
  for (const sentence of sentences(text)) {
    // Figures: every currency-adjacent number, and every non-trivial number, must exist in the records.
    for (const m of sentence.matchAll(NUMBER_RE)) {
      const c = canonicalNumber(m[0]);
      const idx = m.index ?? 0;
      const around = sentence.slice(Math.max(0, idx - 6), idx) + " " + sentence.slice(idx + m[0].length, idx + m[0].length + 8);
      const trivial = /^\d{1,2}$/.test(c) && !CURRENCY_NEAR.test(around);
      if (!trivial && !facts.numbers.has(c)) reasons.add("an amount or number that no backend record supports");
    }
    if (NON_ASSERTIVE.test(sentence)) continue;
    if (PAID_CLAIM.test(sentence) && !facts.paymentExists) reasons.add("a payment status that the ledger does not show");
    if (APPROVED_CLAIM.test(sentence) && !facts.approvalExists) reasons.add("an approval that was not recorded");
  }
  const all = text;
  if (facts.proposalPreference && facts.proposalPreference !== "cheapest" && CHEAPEST_CLAIM.test(all)) reasons.add("a cheapest-route claim that the proposal does not support");
  if (facts.proposalPreference && facts.proposalPreference !== "fastest" && FASTEST_CLAIM.test(all)) reasons.add("a fastest-route claim that the proposal does not support");
  return { ok: reasons.size === 0, reasons: [...reasons] };
}
