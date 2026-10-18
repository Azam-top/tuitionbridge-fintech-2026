// Bounded REAL-model smoke test of the LIVE mode, on an in-memory database (your live database is never touched).
// It uses your key (APP_LLM_API_KEY, APP_LLM_MODEL), the real Wise public quote endpoint and the real NBK feed, with ONE synthetic
// student, university and invoice created in memory. It spends real API credits (a few thousand tokens).   npm run smoke:live
import { existsSync } from "node:fs";
import { loadConfig, agentStatus } from "../src/server/config";
import { openDb } from "../src/server/db";
import { systemClock } from "../src/server/clock";
import { createLlm } from "../src/server/agent/factory";
import { createRunner, getTask } from "../src/server/agent/runner";
import { registerUser, declareFunds } from "../src/server/services/accounts";
import { attestRecipient } from "../src/server/services/recipients";
import { confirmInvoice, createInvoice } from "../src/server/services/invoices";
import { proposalView } from "../src/server/services/proposals";
import { listOffers } from "../src/server/services/offers";
import { instructionForProposal } from "../src/server/services/instructions";

if (existsSync(".env")) process.loadEnvFile(".env");
const base = loadConfig({ ...process.env, APP_MODE: "live", APP_WISE_QUOTES: "1", APP_NBK_RATES: "1" });
if (agentStatus(base) !== "LIVE") {
  console.error("LIVE MODEL NOT VERIFIED: set APP_LLM_API_KEY and APP_LLM_MODEL (see .env.example), then rerun.");
  process.exit(2);
}
const config = { ...base, dbPath: ":memory:", taskTokenBudget: Math.min(base.taskTokenBudget, 40000), uploadDir: "artifacts/tmp/smoke-uploads" };
const ctx = { db: openDb(":memory:", "live"), clock: systemClock, config };

function iban(b: string, cc = "KZ"): string {
  const d = (b + cc + "00").split("").map((c) => (c >= "A" ? String(c.charCodeAt(0) - 55) : c)).join("");
  let r = 0;
  for (const ch of d) r = (r * 10 + Number(ch)) % 97;
  return `${cc}${String(98 - r).padStart(2, "0")}${b}`;
}
const { userId } = registerUser(ctx, { email: "smoke@example.org", displayName: "Smoke Student", password: "smoke-test-password" });
declareFunds(ctx, userId, { usdBalance: "1500", usdReserve: "300" });
attestRecipient(ctx, userId, { name: "Smoke Test University", account: iban("125KZT0000000001"), sourceUrl: "https://example.edu/payments", sourceNote: "synthetic smoke-test recipient" });
const inv = createInvoice(ctx, userId, {
  reference: "SMOKE-1", recipientRegistryId: "", beneficiaryName: "Smoke Test University", beneficiaryAccount: iban("125KZT0000000001"),
  amountKztTiyn: "50000000", dueAt: new Date(Date.now() + 10 * 86_400_000).toISOString(), sourceType: "manual",
});
confirmInvoice(ctx, userId, inv.id);

const runner = createRunner(ctx, createLlm(config));
const t = runner.startTask(userId, "execute", inv.id, "Pay this invoice by its deadline, use the cheapest feasible route, and keep USD 300 for living costs.");
await runner.settled(t.id);
let task = getTask(ctx, userId, t.id);
console.log(`planning -> ${task.state} (model ${task.model})`);
console.log(`offers stored: ${listOffers(ctx, userId, inv.id).map((o) => `${o.providerName} [${o.provenance}]`).join("; ") || "none"}`);
let instructed = false;
if (task.state === "AWAITING_APPROVAL") {
  const p = proposalView(ctx, userId, task.proposal_id!);
  console.log(`proposal: ${p.payload.providerName}, total USD cents ${p.payload.totalDebitCents}, source ${p.payload.quoteProvenance}`);
  await runner.approveAndResume(userId, "execute", t.id, p.hash); // stands in for the human click in this smoke test only
  task = getTask(ctx, userId, t.id);
  instructed = !!instructionForProposal(ctx, userId, p.id);
}
console.log(JSON.stringify({
  state: task.state, instructionIssued: instructed, toolCalls: task.tool_calls, modelRequests: task.model_requests, retries: task.retries,
  usageReported: task.usage_known === 1, inputTokens: task.usage_known ? task.input_tokens : null, outputTokens: task.usage_known ? task.output_tokens : null, latencyMs: task.latency_ms, error: task.error,
}, null, 2));
const ok = task.state === "APPROVED" && instructed && task.usage_known === 1;
console.log(ok ? "LIVE smoke test PASSED (real model, real quote sources, synthetic in-memory student; the app moved no money)." : "LIVE smoke test did NOT pass; see state/error above.");
process.exit(ok ? 0 : 1);
