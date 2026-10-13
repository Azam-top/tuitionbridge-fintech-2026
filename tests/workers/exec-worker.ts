// Child process used by concurrency.test.ts: executes a payment against a shared SQLite file at a barrier time.
import { openDb } from "../../src/server/db.js";
import { loadConfig } from "../../src/server/config.js";
import { TestClock } from "../../src/server/clock.js";
import { executePayment } from "../../src/server/services/execution.js";
import { PolicyError } from "../../src/server/errors.js";

const [dbPath, owner, proposalId, approvalId, key, nowIso, startAt] = process.argv.slice(2);
const ctx = { db: openDb(dbPath), clock: new TestClock(Date.parse(nowIso)), config: loadConfig({ APP_DEMO_MODE: "1" }) };
while (Date.now() < Number(startAt)) { /* spin to the barrier so processes collide */ }
try {
  const r = executePayment(ctx, { ownerId: owner, tier: "execute", proposalId, approvalId, idempotencyKey: key });
  process.stdout.write(JSON.stringify({ ok: true, paymentId: r.receipt.paymentId, replayed: r.replayed }));
} catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, code: e instanceof PolicyError ? e.code : "CRASH:" + String(e) }));
}
