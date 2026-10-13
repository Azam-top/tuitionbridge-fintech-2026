import { formatKzt, formatUsd } from "../shared/money";
export { formatKzt, formatUsd };

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
}

/** Whole-number-of-hours estimate relative to a base, for readability only. */
export function fmtRelative(iso: string, baseIso: string): string {
  const ms = Date.parse(iso) - Date.parse(baseIso);
  if (Number.isNaN(ms)) return "";
  const mins = Math.round(ms / 60000);
  const abs = Math.abs(mins);
  const txt = abs >= 120 ? `${Math.round(abs / 60)} h` : `${abs} min`;
  return mins >= 0 ? `in ${txt}` : `${txt} ago`;
}

/** Exact decimal KZT text ("500,000.50") -> tiyn string, without floating point. */
export function kztToTiyn(text: string): string | null {
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  return (BigInt(m[1].replace(/,/g, "")) * 100n + BigInt((m[2] ?? "").padEnd(2, "0") || "0")).toString();
}

export function tiynToInput(tiyn: string): string {
  if (!/^\d+$/.test(tiyn)) return "";
  const v = BigInt(tiyn);
  const whole = v / 100n;
  const frac = (v % 100n).toString().padStart(2, "0");
  return frac === "00" ? whole.toString() : `${whole}.${frac}`;
}

export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
