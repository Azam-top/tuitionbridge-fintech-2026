// Bounded LIVE smoke test: ONE synthetic task through the real provider adapter, stopping at AWAITING_APPROVAL
// and then approving + executing in the SIMULATED ledger. It spends real API credits (a few thousand tokens).
// Run only when you intentionally configured APP_LLM_API_KEY and APP_LLM_MODEL (e.g. in .env):
//   npm run smoke:live
import { existsSync } from "node:fs";
import { loadConfig, agentMode } from "../src/server/config";
import { openDb } from "../src/server/db";
import { systemClock } from "../src/server/clock";
import { createLlm } from "../src/server/agent/factory";
import { createRunner, getTask } from "../src/server/agent/runner";
import { resetDemo } from "../src/server/services/seed";
import { confirmInvoice, listInvoices } from "../src/server/services/invoices";
import { proposalView } from "../src/server/services/proposals";

if (existsSync(".env")) process.loadEnvFile(".env");
const base = loadConfig();
if (agentMode(base) !== "LIVE") {
  console.error("LIVE MODE NOT VERIFIED: set APP_LLM_API_KEY and APP_LLM_MODEL (see .env.example), then rerun.");
  process.exit(2);
}
const config = { ...base, dbPath: ":memory:", taskTokenBudget: Math.min(base.taskTokenBudget, 40000) };
const ctx = { db: openDb(":memory:"), clock: systemClock, config };
resetDemo(ctx);
const user = "usr_alice";
const invoiceId = listInvoices(ctx, user)[0].id;
confirmInvoice(ctx, user, invoiceId);
const runner = createRunner(ctx, createLlm(config));
const t = runner.startTask(user, "execute", invoiceId, "Pay this invoice by its deadline, use the cheapest feasible route, and keep USD 300 for living costs.");
await runner.settled(t.id);
let task = getTask(ctx, user, t.id);
console.log(`phase 1 -> ${task.state} (mode ${task.mode}, model ${task.model})`);
if (task.state === "AWAITING_APPROVAL") {
  const p = proposalView(ctx, user, task.proposal_id!);
  console.log(`proposal provider ${p.payload.providerId}, total debit ${p.payload.totalDebitCents} cents`);
  await runner.approveAndResume(user, "execute", t.id, p.hash); // stands in for the human click in this smoke test only
  await runner.settled(t.id);
  task = getTask(ctx, user, t.id);
}
console.log(JSON.stringify({
  state: task.state, toolCalls: task.tool_calls, modelRequests: task.model_requests, retries: task.retries,
  usageReported: task.usage_known === 1, inputTokens: task.usage_known ? task.input_tokens : null, outputTokens: task.usage_known ? task.output_tokens : null,
  latencyMs: task.latency_ms, error: task.error,
}, null, 2));
const ok = task.state === "COMPLETED" && task.usage_known === 1;
console.log(ok ? "LIVE smoke test PASSED (synthetic data, simulated payment)." : "LIVE smoke test did NOT pass; see state/error above.");
process.exit(ok ? 0 : 1);
