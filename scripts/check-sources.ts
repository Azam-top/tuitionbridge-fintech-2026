// Read-only check of the REAL external sources the live mode uses. It sends no personal data (Wise gets only currencies and an
// amount) and creates no account, no transfer and no database. It prints what the sources return right now.   npm run check:sources
import { loadConfig } from "../src/server/config";
import { openDb } from "../src/server/db";
import { systemClock } from "../src/server/clock";
import { fetchWiseJson, parseWiseQuote } from "../src/server/services/offers";
import { refreshReferenceRate } from "../src/server/services/reference-rate";
import { formatUsd, formatKzt } from "../src/shared/money";

const config = loadConfig({ ...process.env, APP_MODE: "live", APP_WISE_QUOTES: "1", APP_NBK_RATES: "1" });
const ctx = { db: openDb(":memory:", "live"), clock: systemClock, config };
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
  console.log(`  - ${o.providerName}: rate ${o.rate}, fee ${formatUsd(o.feeCents)}, est. delivery ${o.estArrivalAt}, quote expires ${o.expiresAt} (${o.provenance})`);
}
process.exit(opts.length ? 0 : 2);
