// National Bank of Kazakhstan official reference rate. A REFERENCE only: never a transfer offer, a fee or an ETA.
import { createHash } from "node:crypto";
import type { Ctx } from "../ctx.js";
import { httpFetch } from "../ctx.js";
import { newId } from "../ids.js";
import { PolicyError } from "../errors.js";

export const NBK_URL = "https://nationalbank.kz/rss/rates_all.xml";
const MAX_AGE_MS = 6 * 3600_000;
/** After this age the rate is shown as stale. NBK sets one rate per day. */
export const STALE_AFTER_MS = 36 * 3600_000;

export interface ReferenceRate {
  source: "NBK"; pair: "USD/KZT"; rate: string; quantity: string; effectiveDate: string; retrievedAt: string; url: string; bodySha256: string; stale: boolean;
}

/** Pure parser for the NBK RSS body. Returns null if the USD item is absent or malformed. */
export function parseNbkUsd(xml: string): { rate: string; quantity: string; effectiveDate: string } | null {
  for (const item of xml.split(/<item>/i).slice(1)) {
    if (!/<title>\s*USD\s*<\/title>/i.test(item)) continue;
    const rate = /<description>\s*([0-9]+(?:\.[0-9]+)?)\s*<\/description>/i.exec(item)?.[1];
    const quantity = /<quant>\s*([0-9]+)\s*<\/quant>/i.exec(item)?.[1];
    const date = /<pubDate>\s*(\d{2})\.(\d{2})\.(\d{4})\s*<\/pubDate>/i.exec(item);
    if (!rate || !quantity || !date || Number(quantity) < 1) return null;
    return { rate, quantity, effectiveDate: `${date[3]}-${date[2]}-${date[1]}` };
  }
  return null;
}

export function latestReference(ctx: Ctx): ReferenceRate | null {
  const r = ctx.db.prepare("SELECT * FROM reference_rates WHERE source = 'NBK' AND pair = 'USD/KZT' ORDER BY retrieved_at DESC, rowid DESC LIMIT 1").get() as
    | { rate: string; quantity: string; effective_date: string; retrieved_at: string; url: string; body_sha256: string } | undefined;
  if (!r) return null;
  return {
    source: "NBK", pair: "USD/KZT", rate: r.rate, quantity: r.quantity, effectiveDate: r.effective_date, retrievedAt: r.retrieved_at, url: r.url, bodySha256: r.body_sha256,
    stale: ctx.clock.now().getTime() - Date.parse(r.retrieved_at) > STALE_AFTER_MS,
  };
}

/** Fetches and stores the rate if the cached one is older than 6 hours. A network failure keeps the (dated) cache and never invents a value. */
export async function refreshReferenceRate(ctx: Ctx, force = false): Promise<{ reference: ReferenceRate | null; status: "FRESH" | "CACHED" | "UNAVAILABLE" | "DISABLED" }> {
  const cached = latestReference(ctx);
  if (!ctx.config.nbkRates) return { reference: cached, status: "DISABLED" };
  if (!force && cached && ctx.clock.now().getTime() - Date.parse(cached.retrievedAt) < MAX_AGE_MS) return { reference: cached, status: "CACHED" };
  try {
    const res = await httpFetch(ctx)(NBK_URL, { signal: AbortSignal.timeout(10_000), headers: { accept: "application/xml,text/xml" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    const parsed = parseNbkUsd(body);
    if (!parsed) throw new Error("USD item not found");
    ctx.db.prepare("INSERT INTO reference_rates (id, source, pair, rate, quantity, effective_date, retrieved_at, body_sha256, url) VALUES (?,?,?,?,?,?,?,?,?)").run(
      newId("ref"), "NBK", "USD/KZT", parsed.rate, parsed.quantity, parsed.effectiveDate, ctx.clock.now().toISOString(), createHash("sha256").update(body).digest("hex"), NBK_URL,
    );
    return { reference: latestReference(ctx), status: "FRESH" };
  } catch {
    return { reference: cached, status: "UNAVAILABLE" };
  }
}

/** Percent difference of an offered rate from the reference, as a signed integer in basis points (1/100 of a percent). */
export function deviationBps(offered: string, ref: ReferenceRate): number {
  const o = Number(offered);
  const r = Number(ref.rate) / Number(ref.quantity);
  return Math.round(((o - r) / r) * 10_000);
}

export function requireReference(ctx: Ctx): ReferenceRate {
  const r = latestReference(ctx);
  if (!r) throw new PolicyError("SOURCE_UNAVAILABLE", "No official reference rate has been retrieved yet.");
  return r;
}
