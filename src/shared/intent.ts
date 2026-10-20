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
const USD_TOKEN = "(?:usd|us\\s*dollars?|dollars?|долл\\S*|доллар\\S*)";
const OTHER_TOKEN = "(?:eur|euros?|евро|kzt|tenge|тенге|gbp|pounds?|rub|rubles?|руб\\S*|cny|rmb|yuan|юан\\S*|jpy|yen|aed|dirhams?)";
const SYMBOL = "[$€£₸¥₽]";
const CUR = `(?:${USD_TOKEN}|${OTHER_TOKEN}|${SYMBOL})`;
const NUM = "(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.(\\d{1,2}))?";

function detectLanguage(text: string): ParsedIntent["language"] {
  if (/[Ѐ-ӿ]/.test(text)) return "ru";
  if (/[a-z]/i.test(text)) return "en";
  return "unknown";
}

const isUsd = (cur: string): boolean => cur === "$" || new RegExp(`^${USD_TOKEN}$`, "i").test(cur);

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

  // Collect every reserve mention with its currency. Several different amounts, or a currency other
  // than USD, are surfaced for clarification instead of silently picking one.
  const mention = new RegExp(`${RESERVE_WORDS}[^\\d$€£₸¥₽]{0,40}?(${CUR})?\\s*${NUM}(?:\\s*(${CUR}))?`, "gi");
  const amounts = new Set<string>();
  const foreign = new Set<string>();
  for (const m of text.matchAll(mention)) {
    const cur = (m[1] ?? m[4] ?? "").trim();
    if (cur && !isUsd(cur)) foreign.add(cur);
    else amounts.add(toCents(m[2], m[3]));
  }
  let reserveCents: string | null = null;
  if (foreign.size) {
    ambiguous.push(`The reserve currency (${[...foreign].join(", ")}) is not supported; the living-expense reserve must be in USD.`);
  } else if (amounts.size > 1) {
    ambiguous.push("Several different reserve amounts were mentioned.");
  } else if (amounts.size === 1) {
    reserveCents = [...amounts][0];
  }
  if (reserveCents !== null && BigInt(reserveCents) === 0n) {
    ambiguous.push("A zero reserve was requested.");
  }
  return { preference, reserveCents, ambiguous, language: detectLanguage(text) };
}
