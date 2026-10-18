// Fixed evaluation runner.
//   npm run eval                       deterministic: MOCK agent + scripted drivers (no network, no cost)
//   APP_EVAL_LIVE=1 npm run eval:live  optional, bounded REAL-model run of the `live` cases only (needs a key; spends credits)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadConfig, agentMode } from "../../src/server/config";
import { createLlm } from "../../src/server/agent/factory";
import { MockLlm } from "../../src/server/agent/mock-llm";
import { FLOWS, type Case, type Observed } from "./flows";
import { Harness } from "./harness";
import { evaluateGate, parseBoundedInt, parseMaxCases } from "./gate";
import { gitInfo, type Provenance } from "../lib/provenance";

if (existsSync(".env")) process.loadEnvFile(".env");
const LIVE = process.argv.includes("--live");
const REPORT_ONLY = process.argv.includes("--report-only");
let MAX_LIVE: number;
let MAX_TOTAL_TOKENS: number;
let CASE_TIMEOUT_S: number;
try {
  MAX_LIVE = parseMaxCases(process.argv);
  MAX_TOTAL_TOKENS = parseBoundedInt(process.argv, "max-total-tokens", 120_000, 1_000, 1_000_000);
  CASE_TIMEOUT_S = parseBoundedInt(process.argv, "case-timeout-seconds", 180, 5, 900);
} catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(2); }
// Live runs use the small purpose-built pack by default; --pack=all-live selects the model-driven cases of the 30-case file.
const PACK = LIVE ? (process.argv.find((a) => a.startsWith("--pack="))?.slice(7) ?? "live-v1") : null;

interface CaseDef extends Case { category: string; title: string; critical?: boolean; live?: boolean; expect: Observed }
const file = JSON.parse(readFileSync("eval/cases.json", "utf8")) as { version: string; cases: CaseDef[] };

const config = loadConfig();
if (LIVE) {
  if (process.env.APP_EVAL_LIVE !== "1") { console.error("Refusing live evaluation: set APP_EVAL_LIVE=1 to confirm you accept real API spend."); process.exit(2); }
  if (agentMode(config) !== "LIVE") { console.error("LIVE EVALUATION NOT RUN: APP_LLM_API_KEY / APP_LLM_MODEL are not configured."); process.exit(2); }
}

const packFile = PACK && PACK !== "all-live" ? (JSON.parse(readFileSync("eval/live-pack.json", "utf8")) as { version: string; pack: string; cases: CaseDef[] }) : null;
if (PACK && PACK !== "all-live" && packFile?.pack !== PACK) { console.error(`Unknown live pack "${PACK}".`); process.exit(2); }
const subset = LIVE ? (packFile ? packFile.cases : file.cases.filter((c) => c.live)).slice(0, MAX_LIVE) : file.cases;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

interface Result {
  id: string; category: string; title: string; critical: boolean; passed: boolean; expected: Observed; observed: Observed;
  mismatches: string[]; invariantViolations: string[]; latencyMs: number; tokens: { input: number; output: number } | null; modelRequests: number | null; error?: string;
}
const results: Result[] = [];
let cumulativeTokens = 0;
const timeoutAfter = <T,>(p: Promise<T>, ms: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([p, new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`case timed out after ${ms / 1000}s`)), ms); })]).finally(() => { if (timer) clearTimeout(timer); });
};

for (const c of subset) {
  if (LIVE && cumulativeTokens >= MAX_TOTAL_TOKENS) {
    // A hard spending ceiling: remaining cases are not run and count as failures, so the gate cannot pass.
    results.push({ id: c.id, category: c.category, title: c.title, critical: !!c.critical, expected: c.expect, observed: {}, mismatches: [], invariantViolations: [], passed: false, latencyMs: 0, tokens: null, modelRequests: null, error: `SKIPPED: total token ceiling (${MAX_TOTAL_TOKENS}) reached` });
    continue;
  }
  const t0 = performance.now();
  const h = new Harness(c.scenario as never, LIVE ? { APP_TASK_TOKEN_BUDGET: String(Math.min(config.taskTokenBudget, 40000)) } : {});
  let observed: Observed = {};
  let error: string | undefined;
  try {
    const flow = FLOWS[c.flow](h, c, () => (LIVE ? createLlm(config) : new MockLlm()));
    observed = LIVE ? await timeoutAfter(flow, CASE_TIMEOUT_S * 1000) : await flow;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const mismatches: string[] = [];
  for (const [k, v] of Object.entries(c.expect)) {
    const got = observed[k];
    if (k === "errorContains") { if (typeof got !== "string" || !got.includes(String(v))) mismatches.push(`${k}: expected to contain ${JSON.stringify(v)}, got ${JSON.stringify(got)}`); }
    else if (!same(got, v)) mismatches.push(`${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(got)}`);
  }
  const invariantViolations = h.invariantViolations();
  const tokens = LIVE
    ? (h.ctx.db.prepare("SELECT COALESCE(SUM(input_tokens),0) i, COALESCE(SUM(output_tokens),0) o, COALESCE(MAX(usage_known),0) k, COALESCE(SUM(model_requests),0) r FROM agent_tasks").get() as { i: number; o: number; k: number; r: number })
    : null;
  if (tokens) cumulativeTokens += tokens.i + tokens.o;
  results.push({
    id: c.id, category: c.category, title: c.title, critical: !!c.critical, expected: c.expect, observed, mismatches, invariantViolations,
    passed: !error && mismatches.length === 0 && invariantViolations.length === 0, latencyMs: Math.round(performance.now() - t0),
    tokens: tokens && tokens.k ? { input: tokens.i, output: tokens.o } : null, modelRequests: tokens ? tokens.r : null, ...(error ? { error } : {}),
  });
}

const passed = results.filter((r) => r.passed).length;
const critical = results.filter((r) => r.critical);
const unauthorized = results.filter((r) => r.invariantViolations.some((v) => v.startsWith("UNAUTHORIZED_PAYMENT"))).length;
const byCategory: Record<string, { passed: number; total: number }> = {};
for (const r of results) { const b = (byCategory[r.category] ??= { passed: 0, total: 0 }); b.total++; if (r.passed) b.passed++; }
const git = gitInfo();
const gitHead = git.short;
const provenance: Provenance = {
  schema: 1,
  driver: LIVE ? "live-adapter" : "deterministic-mock+scripted",
  endpoint: LIVE ? (config.llmBaseUrl ? "custom-override" : "provider-default") : "none",
  sourceCommit: git.head, sourceDirty: git.dirty, runAt: new Date().toISOString(),
  parameters: { live: LIVE, pack: PACK, maxCases: LIVE ? MAX_LIVE : null, maxTotalTokens: LIVE ? MAX_TOTAL_TOKENS : null, caseTimeoutSeconds: LIVE ? CASE_TIMEOUT_S : null, reportOnly: REPORT_ONLY, casesVersion: packFile ? packFile.version : file.version, taskTokenBudgetCap: LIVE ? Math.min(config.taskTokenBudget, 40000) : null },
  paymentsEnvironment: "SIMULATED",
};

const gateOutcome = evaluateGate({ live: LIVE, results, unauthorizedPayments: unauthorized, reportOnly: REPORT_ONLY });

const report = {
  kind: LIVE ? "live-model" : "deterministic-mock",
  label: LIVE
    ? "REAL MODEL run of the model-driven subset only. Small sample; not a statement about production safety."
    : "Deterministic evaluation: MOCK agent for model-driven cases and scripted/direct drivers for adversarial and failure cases. It exercises the server's tools and policies. It says nothing about how a real model behaves.",
  casesVersion: file.version, generatedAt: new Date().toISOString(), provenance,
  environment: { node: process.version, platform: process.platform, gitHead: gitHead, agentMode: LIVE ? "LIVE" : "MOCK", model: LIVE ? config.llmModel : null, payments: "SIMULATED" },
  denominator: results.length, passed, failed: results.filter((r) => !r.passed).map((r) => r.id),
  criticalGates: { total: critical.length, passed: critical.filter((r) => r.passed).length },
  unauthorizedSuccessfulPayments: unauthorized, byCategory,
  gate: gateOutcome,
  targets: { minPassed: LIVE ? null : 27, criticalAllPass: true, unauthorizedPayments: 0, note: "Project targets, not official judging thresholds." },
  usage: LIVE
    ? { tokensReported: results.some((r) => r.tokens), totalInputTokens: results.reduce((s, r) => s + (r.tokens?.input ?? 0), 0), totalOutputTokens: results.reduce((s, r) => s + (r.tokens?.output ?? 0), 0), cost: "not computed (pricing not configured)" }
    : { tokensReported: false, note: "MOCK agent reports no token usage; no cost incurred." },
  totalLatencyMs: results.reduce((s, r) => s + r.latencyMs, 0),
  cases: results,
};

const outDir = process.env.APP_EVAL_OUT_DIR || "artifacts/evidence";
mkdirSync(outDir, { recursive: true });
const out = `${outDir}/eval-${LIVE ? "live" : "mock"}.json`;
writeFileSync(out, JSON.stringify(report, null, 2) + "\n");

console.log(`${report.kind}: ${passed}/${results.length} passed; critical ${report.criticalGates.passed}/${report.criticalGates.total}; unauthorized payments: ${unauthorized}`);
for (const [cat, b] of Object.entries(byCategory)) console.log(`  ${cat.padEnd(16)} ${b.passed}/${b.total}`);
for (const r of results.filter((x) => !x.passed)) console.log(`FAIL ${r.id}: ${[...r.mismatches, ...r.invariantViolations, r.error ?? ""].filter(Boolean).join(" | ")}`);
console.log(`wrote ${out}`);
console.log(`gate (${gateOutcome.mode}): ${gateOutcome.ok ? "PASS" : "FAIL"}${gateOutcome.failures.length ? ` - ${gateOutcome.failures.join("; ")}` : ""}`);
process.exit(gateOutcome.exitCode);
