// Exact money math. Amounts are BigInt minor units internally (USD cents, KZT tiyn)
// and integer strings on the wire. Never use floating point for money.

export type Currency = "USD" | "KZT";

const MINOR_RE = /^\d{1,18}$/;

export function parseMinor(value: string, label = "amount"): bigint {
  if (typeof value !== "string" || !MINOR_RE.test(value)) {
    throw new MoneyError(`${label} must be a non-negative integer string of minor units`);
  }
  return BigInt(value);
}

export function parsePositiveMinor(value: string, label = "amount"): bigint {
  const v = parseMinor(value, label);
  if (v <= 0n) throw new MoneyError(`${label} must be positive`);
  return v;
}

export class MoneyError extends Error {
  readonly code = "INVALID_MONEY";
}

/** Exact decimal rate: value = num / den, with den = 10^scale. */
export interface Rate {
  num: bigint;
  den: bigint;
  text: string;
}

const RATE_RE = /^(\d{1,6})(?:\.(\d{1,6}))?$/;

export function parseRate(text: string): Rate {
  const m = RATE_RE.exec(text);
  if (!m) throw new MoneyError("rate must be a positive decimal with at most 6 fractional digits");
  const frac = m[2] ?? "";
  const num = BigInt(m[1] + frac);
  const den = 10n ** BigInt(frac.length);
  if (num <= 0n) throw new MoneyError("rate must be positive");
  return { num, den, text };
}

export function ceilDiv(a: bigint, b: bigint): bigint {
  if (b <= 0n) throw new MoneyError("division by non-positive");
  return (a + b - 1n) / b;
}

/** USD cents the sender must convert so the recipient gets at least `tuitionTiyn`. Rounded UP. */
export function senderPrincipalCents(tuitionTiyn: bigint, rate: Rate): bigint {
  // cents = tiyn / (KZT per USD)  [1 cent * rate KZT/USD = rate tiyn]
  return ceilDiv(tuitionTiyn * rate.den, rate.num);
}

/** KZT tiyn actually delivered from `principalCents`. Rounded DOWN, never overstates delivery. */
export function recipientTiyn(principalCents: bigint, rate: Rate): bigint {
  return (principalCents * rate.num) / rate.den;
}

export function groupDigits(n: bigint): string {
  const s = n.toString();
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatMinor(minor: bigint, symbol: string): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${symbol} ${groupDigits(whole)}.${frac}`;
}

export const formatUsd = (cents: bigint | string): string => formatMinor(BigInt(cents), "USD");
export const formatKzt = (tiyn: bigint | string): string => formatMinor(BigInt(tiyn), "KZT");

/**
 * Exact conversion of a decimal amount quoted by a provider into minor units, with no floating-point arithmetic.
 * Accepts the decimal TEXT ("1126.82") or a JSON number, which is read through its shortest decimal form (for amounts with at
 * most 15 significant digits that is exactly the text the provider sent). Refuses signs, exponents, more than two decimals,
 * more than 13 whole digits and zero when `allowZero` is false. Never rounds: an amount that does not fit is an error.
 */
export function exactDecimalToMinor(value: unknown, label = "amount", allowZero = false): bigint {
  const text = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : typeof value === "string" ? value : "";
  const m = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) throw new MoneyError(`${label} is not an exact decimal amount with at most 2 decimals`);
  const minor = BigInt(m[1]) * 100n + BigInt((m[2] ?? "").padEnd(2, "0") || "0");
  if (minor === 0n && !allowZero) throw new MoneyError(`${label} must be positive`);
  return minor;
}

/** Exact decimal text ("1,234.50") -> minor-unit BigInt with at most 2 fractional digits; no floating point. */
export function decimalToMinor(text: string, label = "amount"): bigint {
  const m = /^(\d{1,3}(?:,\d{3})+|\d{1,13})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!m) throw new MoneyError(`${label} must be a plain decimal number with at most 2 decimals`);
  return BigInt(m[1].replace(/,/g, "")) * 100n + BigInt((m[2] ?? "").padEnd(2, "0") || "0");
}
