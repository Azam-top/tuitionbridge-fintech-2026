// Bounded REAL-model smoke test of the LIVE mode, on an in-memory database (your live database is never touched).
// It uses your provider (APP_LLM_PROVIDER: anthropic | groq), key (APP_LLM_API_KEY) and model (APP_LLM_MODEL), the real Wise public quote endpoint and the real NBK feed, with ONE synthetic
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
if (base.llmProvider === "unsupported") {
  console.error('LIVE MODEL NOT VERIFIED: APP_LLM_PROVIDER must be "anthropic" or "groq" (see .env.example).');
  process.exit(2);
}
if (agentStatus(base) !== "LIVE") {
  console.error("LIVE MODEL NOT VERIFIED: set APP_LLM_PROVIDER, APP_LLM_API_KEY and APP_LLM_MODEL (see .env.example), then rerun.");
  process.exit(2);
}
if (base.llmBaseUrl) {
  console.error("LIVE MODEL NOT VERIFIED: APP_LLM_BASE_URL overrides the provider endpoint (meant for local fakes). Unset it for a real run.");
  process.exit(2);
}
// Nothing printed below may contain the key, even by accident.
const scrub = (v: string): string => (base.llmApiKey ? v.split(base.llmApiKey).join("[key]") : v);
const say = (...a: unknown[]) => console.log(scrub(a.map(String).join(" ")));
say(`provider=${base.llmProvider} model=${base.llmModel} key=${base.llmApiKey ? "present (hidden)" : "missing"} endpoint=provider default`);
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
say(`planning -> ${task.state} (model ${task.model})`);
say(`offers stored: ${listOffers(ctx, userId, inv.id).map((o) => `${o.providerName} [${o.provenance}]`).join("; ") || "none"}`);
let instructed = false;
if (task.state === "AWAITING_APPROVAL") {
  const p = proposalView(ctx, userId, task.proposal_id!);
  say(`proposal: ${p.payload.providerName}, total USD cents ${p.payload.totalDebitCents}, source ${p.payload.quoteProvenance}`);
  await runner.approveAndResume(userId, "execute", t.id, p.hash); // stands in for the human click in this smoke test only
  task = getTask(ctx, userId, t.id);
  instructed = !!instructionForProposal(ctx, userId, p.id);
}
// De-identified tool-call log: tool, outcome, arguments with ids masked, and only the SHAPE of each result (top-level keys or the error code).
const mask = (v: unknown): unknown => (typeof v === "string" ? v.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<id>").replace(/\b([a-z]{1,6})_[0-9a-f]{12,}\b/g, "$1_<id>") : Array.isArray(v) ? v.map(mask) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mask(x)])) : v);
const events = ctx.db.prepare("SELECT seq, kind, tool, ok, input_json, output_json, text FROM agent_events WHERE task_id = ? ORDER BY seq").all(t.id) as { seq: number; kind: string; tool: string | null; ok: number | null; input_json: string | null; output_json: string | null; text: string | null }[];
say("tool calls (de-identified):");
for (const e of events) {
  if (e.kind === "tool") {
    const out = e.output_json ? (JSON.parse(e.output_json) as Record<string, unknown>) : {};
    const err = (out.error as { code?: string } | undefined)?.code;
    say(`  #${e.seq} ${e.tool} ${e.ok ? "ok" : "ERROR"} args=${JSON.stringify(mask(e.input_json ? JSON.parse(e.input_json) : {}))} result=${err ? `error ${err}` : `keys [${Object.keys(out).join(", ")}]`}`);
  } else if (e.kind === "retry" || e.kind === "assistant_withheld" || e.kind === "explanation_unavailable") say(`  #${e.seq} ${e.kind}: ${e.text}`);
  else if (e.kind === "assistant") say(`  #${e.seq} assistant text shown (${(e.text ?? "").length} chars)`);
}
say(JSON.stringify({
  provider: base.llmProvider, model: task.model,
  state: task.state, instructionIssued: instructed, toolCalls: task.tool_calls, modelRequests: task.model_requests, retries: task.retries,
  usageReported: task.usage_known === 1, inputTokens: task.usage_known ? task.input_tokens : null, outputTokens: task.usage_known ? task.output_tokens : null, latencyMs: task.latency_ms, error: task.error,
}, null, 2));
const ok = task.state === "APPROVED" && instructed && task.usage_known === 1;
say(ok ? "LIVE smoke test PASSED (real model, real quote sources, synthetic in-memory student; the app moved no money)." : "LIVE smoke test did NOT pass; see state/error above.");
process.exit(ok ? 0 : 1);
