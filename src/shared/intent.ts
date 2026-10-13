// Deterministic instruction parser (English + a tested Russian subset).
// Output is a *candidate* intent; the server validates it and the UI shows it before approval.

import type { Preference } from "./policy.js";

export interface ParsedIntent {
  preference: Preference | null;
  reserveCents: string | null;
  ambiguous: string[];
  language: "en" | "ru" | "unknown";
}

const CHEAP = /(cheap|lowest\s+(cost|fee|price)|least\s+expensive|min(imum)?\s+(cost|fee)|деш[её]в|минимальн\S*\s+(комисси|стоимост))/i;
const FAST = /(fast|quick|soon|earliest|speed|быстр|скор|поскорее)/i;
const RESERVE_WORDS = "(?:keep|reserve|retain|leave|save|hold|оставь|оставить|сохрани|сохранить|резерв)";
const CUR = "(?:usd|\\$|us\\s*dollars?|dollars?|долл\\S*|доллар\\S*)";
const NUM = "(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.(\\d{1,2}))?";

function detectLanguage(text: string): ParsedIntent["language"] {
  if (/[Ѐ-ӿ]/.test(text)) return "ru";
  if (/[a-z]/i.test(text)) return "en";
  return "unknown";
}

function toCents(whole: string, frac?: string): string {
  const w = BigInt(whole.replace(/,/g, ""));
  const f = BigInt((frac ?? "").padEnd(2, "0") || "0");
  return (w * 100n + f).toString();
}

export function parseInstruction(text: string): ParsedIntent {
  const ambiguous: string[] = [];
  const cheap = CHEAP.test(text);
  const fast = FAST.test(text);
  let preference: Preference | null = null;
  if (cheap && fast) {
    // "cheapest feasible ... prefer faster arrival" style conflicts are surfaced, not guessed.
    ambiguous.push("Both a cheapest and a fastest preference were mentioned.");
  } else if (cheap) preference = "cheapest";
  else if (fast) preference = "fastest";

  let reserveCents: string | null = null;
  const before = new RegExp(`${RESERVE_WORDS}[^\\d$]{0,40}?${CUR}?\\s*${NUM}`, "i");
  const after = new RegExp(`${RESERVE_WORDS}[^\\d$]{0,40}?${NUM}\\s*${CUR}`, "i");
  const m1 = before.exec(text);
  const m2 = after.exec(text);
  const hit = m2 ?? m1;
  if (hit) reserveCents = toCents(hit[1], hit[2]);
  if (reserveCents !== null && BigInt(reserveCents) === 0n) {
    ambiguous.push("A zero reserve was requested.");
  }
  return { preference, reserveCents, ambiguous, language: detectLanguage(text) };
}
