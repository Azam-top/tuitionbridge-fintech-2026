// Read-only check of the REAL external sources the live mode uses. It sends no personal data (Wise gets only currencies and an
// amount) and creates no account, no transfer and no database file. It prints what the sources return right now, then runs the whole
// path on that ONE Wise response (one request) with a synthetic in-memory student and no model:
//   stored quote -> ranking -> proposal -> hash -> approval -> instruction, checking that every stage shows Wise's own amounts.
//   npm run check:sources
import { loadConfig } from "../src/server/config";
import { openDb } from "../src/server/db";
import { systemClock } from "../src/server/clock";
import { fetchWiseJson, parseWiseQuote } from "../src/server/services/offers";
import { refreshReferenceRate } from "../src/server/services/reference-rate";
import { formatUsd, formatKzt } from "../src/shared/money";

const config = loadConfig({ ...process.env, APP_MODE: "live", APP_WISE_QUOTES: "1", APP_NBK_RATES: "1" });
// One real Wise request in total: the response text is kept and replayed to the second code path. Other hosts (NBK) are fetched normally.
let wiseText: string | null = null;
const onceForWise = (async (url: string | URL | Request, init?: RequestInit) => {
  if (!String(url).includes("wise.com")) return fetch(url, init);
  if (wiseText === null) {
    const r = await fetch(url, init);
    if (!r.ok) return r;
    wiseText = await r.text();
  }
  return new Response(wiseText, { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;
const ctx = { db: openDb(":memory:", "live"), clock: systemClock, config, http: { fetch: onceForWise } };
const tuition = 50_000_000n; // KZT 500,000.00, a sample amount

const ref = await refreshReferenceRate(ctx, true);
console.log(ref.reference
  ? `NBK reference: ${ref.reference.rate} KZT per USD, effective ${ref.reference.effectiveDate} (${ref.status}); body sha256 ${ref.reference.bodySha256.slice(0, 16)}...`
  : `NBK reference: ${ref.status}, no value`);

const wise = await fetchWiseJson(ctx, tuition);
if (wise.kind !== "ok") { console.log(`Wise: ${wise.kind.toUpperCase()}: no quote available right now`); process.exit(wise.kind === "no_route" ? 2 : 3); }
const opts = parseWiseQuote(wise.json, tuition);
console.log(`Wise public quote API: ${opts.length} usable USD->KZT option(s) for ${formatKzt(tuition)}:`);
for (const o of opts) {
  const a = o.providerAmounts!;
  console.log(`  - ${o.providerName}: you pay ${formatUsd(a.sourceTotalCents)} (fee ${formatUsd(o.feeCents)}), recipient gets ${formatKzt(a.targetTiyn)}, displayed rate ${o.rate} (display only), est. delivery ${o.estArrivalAt}, quote expires ${o.expiresAt} (${o.provenance})`);
}
if (!opts.length) process.exit(2);

// Full path on this quote, in memory, with ONE synthetic student and NO model: stored quote -> ranking -> proposal -> hash -> approval -> instruction.
// Every stage must show the provider's own numbers. Nothing is sent anywhere; no database file is touched.
const { registerUser, declareFunds } = await import("../src/server/services/accounts");
const { attestRecipient } = await import("../src/server/services/recipients");
const { confirmInvoice, createInvoice } = await import("../src/server/services/invoices");
const { refreshProviderOffers } = await import("../src/server/services/offers");
const { latestQuotesForInvoice } = await import("../src/server/services/quotes");
const { evaluateRoutes } = await import("../src/shared/policy");
const { approveProposal, hashPayload, prepareProposal } = await import("../src/server/services/proposals");
const { issueInstruction } = await import("../src/server/services/instructions");
function iban(b: string, cc = "KZ"): string {
  const d = (b + cc + "00").split("").map((c) => (c >= "A" ? String(c.charCodeAt(0) - 55) : c)).join("");
  let r = 0;
  for (const ch of d) r = (r * 10 + Number(ch)) % 97;
  return `${cc}${String(98 - r).padStart(2, "0")}${b}`;
}
const { userId } = registerUser(ctx, { email: "path@example.org", displayName: "Path Check", password: "path-check-password" });
declareFunds(ctx, userId, { usdBalance: "1500", usdReserve: "300" });
attestRecipient(ctx, userId, { name: "Path Check University", account: iban("125KZT0000000001"), sourceUrl: "https://example.edu/payments", sourceNote: "synthetic path check" });
const inv = createInvoice(ctx, userId, { reference: "PATH-1", recipientRegistryId: "", beneficiaryName: "Path Check University", beneficiaryAccount: iban("125KZT0000000001"), amountKztTiyn: tuition.toString(), dueAt: new Date(Date.now() + 10 * 86_400_000).toISOString(), sourceType: "manual" });
confirmInvoice(ctx, userId, inv.id);
const refreshed = await refreshProviderOffers(ctx, userId, inv.id);
const stored = latestQuotesForInvoice(ctx, userId, inv.id);
const ranked = evaluateRoutes({ quotes: stored, tuitionTiyn: tuition, deadlineAt: inv.dueAt, now: new Date().toISOString(), usdBalanceCents: 150000n, usdReserveCents: 30000n, preference: "cheapest" });
const best = ranked.best;
if (!best) { console.log(`path check: no feasible route (${refreshed.status}); ${ranked.routes.map((r) => r.exclusions.map((e) => e.message).join(" ")).join(" | ")}`); process.exit(2); }
const prop = prepareProposal(ctx, { ownerId: userId, tier: "propose", invoiceId: inv.id, quoteId: best.quoteId, preference: "cheapest", reserveCents: "30000" });
approveProposal(ctx, { ownerId: userId, tier: "execute", proposalId: prop.id, proposalHash: prop.hash });
const ins = issueInstruction(ctx, { ownerId: userId, tier: "execute", proposalId: prop.id });
const wiseOpt = opts.find((o) => o.providerId === best.providerId)!.providerAmounts!;
const stages: [string, string, string][] = [
  ["stored quote total", stored.find((q) => q.id === best.quoteId)!.providerAmounts!.sourceTotalCents, wiseOpt.sourceTotalCents],
  ["ranked total", best.totalDebitCents, wiseOpt.sourceTotalCents],
  ["proposal total", prop.payload.totalDebitCents, wiseOpt.sourceTotalCents],
  ["instruction total", ins.body.youPayUsdCents, wiseOpt.sourceTotalCents],
  ["ranked credit", best.recipientTiyn, wiseOpt.targetTiyn],
  ["proposal credit", prop.payload.recipientTiyn, wiseOpt.targetTiyn],
  ["instruction credit", ins.body.universityShouldReceiveTiyn, wiseOpt.targetTiyn],
  ["proposal fee", prop.payload.feeCents, best.feeCents],
  ["instruction fee", ins.body.providerFeeUsdCents, best.feeCents],
  ["proposal hash binds the payload", hashPayload(prop.payload), prop.hash],
];
let ok = true;
for (const [name, got, want] of stages) { const same = got === want; ok &&= same; console.log(`  ${same ? "ok  " : "FAIL"} ${name}: ${got}${same ? "" : ` (expected ${want})`}`); }
console.log(`path check: best route ${best.providerName}; total ${formatUsd(best.totalDebitCents)}, credit ${formatKzt(best.recipientTiyn)}; ${ok ? "all stages show Wise's own amounts" : "MISMATCH"}`);
process.exit(ok ? 0 : 1);
