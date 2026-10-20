// Presentation helpers for the plan. Every figure comes from the backend (tool output, proposal, receipt); this file only
// formats them and derives plain differences (for example "USD 12.50 more") from backend integers. It decides nothing.
import { useEffect, useState } from "react";
import type { RouteRow, TaskView } from "./api";
import { parseInstruction } from "../shared/intent";
import { fmtTime, formatUsd, tiynToInput } from "./format";
import type { IconName } from "./icons";

export type Preference = "cheapest" | "fastest";

/** Routes exactly as the server ranked them in the latest successful evaluate_routes call (feasible first). */
export function routesOf(view: TaskView | null): { routes: RouteRow[]; best: string | null; preference: string | null } | null {
  if (!view) return null;
  const ev = [...view.events].reverse().find((e) => e.tool === "evaluate_routes" && e.ok);
  if (!ev?.output) return null;
  return {
    routes: (ev.output.routes as RouteRow[] | undefined) ?? [],
    best: (ev.output.bestQuoteId as string | null | undefined) ?? null,
    preference: (ev.output.preference as string | undefined) ?? null,
  };
}

/** The same sentence the example buttons use; the server parses and validates it like any other instruction. */
export function buildInstruction(pref: Preference, reserveCents: string): string {
  return `Pay this invoice by its deadline, use the ${pref} feasible route, and keep USD ${tiynToInput(reserveCents) || "0"} for living costs.`;
}

/** "1 day 4 h", "6 h", "35 min" for a positive span in milliseconds. */
export function span(ms: number): string {
  const min = Math.round(Math.abs(ms) / 60000);
  if (min < 90) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h`;
  const d = Math.floor(h / 24);
  const rest = h - d * 24;
  return rest ? `${d} days ${rest} h` : `${d} days`;
}

export const centsDiff = (a: string, b: string): bigint => BigInt(a) - BigInt(b);

export function diffText(a: string, b: string): string {
  const d = centsDiff(a, b);
  return `${formatUsd(d < 0n ? -d : d)} ${d < 0n ? "less" : "more"}`;
}

export const arrivalLine = (iso: string, deadlineIso?: string): string => {
  if (!deadlineIso) return `Arrives about ${fmtTime(iso)}`;
  const diff = Date.parse(deadlineIso) - Date.parse(iso);
  return `Arrives about ${fmtTime(iso)} · ${diff >= 0 ? `${span(diff)} before the deadline` : `${span(diff)} after the deadline`}`;
};

export function iconForRoute(r: Pick<RouteRow, "provider" | "source">): IconName {
  const n = r.provider.toLowerCase();
  if (n.includes("card")) return "card";
  if (r.source === "USER_DECLARED") return "bank";
  return "swap";
}

/** Server clock aligned to the browser: expiry is judged against server time, refreshed every 10 seconds. */
export function useServerClock(serverNowIso: string | undefined): number {
  const [skew, setSkew] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (serverNowIso) setSkew(Date.parse(serverNowIso) - Date.now()); }, [serverNowIso]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 10_000); return () => clearInterval(t); }, []);
  return now + skew;
}

export const prefersReducedMotion = (): boolean => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/** Preview only: the reserve the server will read out of free text (it validates and may reject it). null = the text names none. */
export function reserveFromText(text: string): { cents: string | null; unclear: boolean } {
  const p = parseInstruction(text);
  return { cents: p.reserveCents, unclear: p.ambiguous.length > 0 };
}

/** The states in which a plan is "in force": its reserve is the single effective reserve everywhere. */
export const PLAN_IN_FORCE = new Set(["RUNNING", "AWAITING_APPROVAL", "EXECUTING", "APPROVED", "COMPLETED"]);

/** "Wise (pay by bank transfer)" -> { title: "Wise", method: "Bank transfer" }; the user's own offers and sandbox quotes are tidied the same way. */
export function providerParts(name: string): { title: string; method: string } {
  const pay = /^(.*?)\s*\(pay by ([^)]*)\)\s*$/i.exec(name);
  if (pay) return { title: pay[1], method: pay[2].charAt(0).toUpperCase() + pay[2].slice(1) };
  const own = /^(.*?)\s*\(offer entered by you\)\s*$/i.exec(name);
  if (own) return { title: own[1], method: "Your offer" };
  const sim = /^(.*?)\s*\(simulated\)\s*$/i.exec(name);
  if (sim) return { title: sim[1], method: "" };
  return { title: name, method: "" };
}
/** One short line for the main screens, for example "Wise bank transfer". */
export const providerShort = (name: string): string => { const { title, method } = providerParts(name); return method && method !== "Your offer" ? `${title} ${method.toLowerCase()}` : title; };

/** Where an option came from, in plain words. The technical wording stays in the closed Details. */
export const SOURCE_NAME: Record<string, string> = { PROVIDER_LIVE: "Wise quote", USER_DECLARED: "Your offer", SIMULATED: "Sandbox test data" };
export function sourceDetail(provenance: string, note: string | null, observedAt: string | null): string {
  const name = SOURCE_NAME[provenance] ?? provenance;
  const when = observedAt ? `${provenance === "USER_DECLARED" ? "seen" : "retrieved"} ${fmtTime(observedAt)}` : "time unknown";
  if (provenance === "PROVIDER_LIVE") return `${name}, ${when}`;
  return `${name}, ${when}${note ? `: ${note}` : ""}`;
}

/** "16:45" in the viewer's time zone. */
export const clockTime = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
};
