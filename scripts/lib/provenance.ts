// Provenance and validation helpers for evaluation reports and evidence. Nothing here calls a model or the network.
// Vocabulary (kept distinct on purpose):
//   deterministic-mock+scripted : MOCK agent for model-driven cases, scripted drivers for adversarial cases. No model call.
//   live-adapter / custom-override : the real Anthropic adapter pointed at a non-default endpoint (e.g. a local fake). Not a real-model run.
//   live-adapter / provider-default : the adapter against the default provider endpoint. Counts as a real-model run ONLY if the
//                                     report also shows reported usage, a passing release gate and a source tree matching the current one.
// Payments are SIMULATED in every case; that is independent of whether the agent is real.
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Paths whose contents determine the behaviour being measured. Artifacts and docs are deliberately excluded. */
export const SOURCE_PATHS = ["src", "scripts", "eval", "tests", "e2e", "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts", "vitest.config.ts", "playwright.config.ts"];

const git = (args: string[]): string | null => {
  try { return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; }
};

export interface GitInfo { head: string | null; short: string | null; dirty: boolean }
export function gitInfo(): GitInfo {
  const head = git(["rev-parse", "HEAD"]);
  const short = git(["rev-parse", "--short", "HEAD"]);
  const status = git(["status", "--porcelain", "--", ...SOURCE_PATHS]);
  return { head, short, dirty: status === null ? false : status.length > 0 };
}

/** Source files that differ between `commit` and the current working tree (committed, modified or untracked). */
export function sourceChangedSince(commit: string): string[] {
  const diff = git(["diff", "--name-only", commit, "--", ...SOURCE_PATHS]);
  if (diff === null) return ["<report commit unknown to this repository>"];
  const untracked = git(["ls-files", "--others", "--exclude-standard", "--", ...SOURCE_PATHS]) ?? "";
  return [...diff.split("\n"), ...untracked.split("\n")].filter(Boolean);
}

export interface Provenance {
  schema: 1;
  driver: "deterministic-mock+scripted" | "live-adapter";
  endpoint: "none" | "provider-default" | "custom-override";
  sourceCommit: string | null;
  sourceDirty: boolean;
  runAt: string;
  parameters: { live: boolean; pack: string | null; maxCases: number | null; maxTotalTokens: number | null; caseTimeoutSeconds: number | null; reportOnly: boolean; casesVersion: string; taskTokenBudgetCap: number | null };
  paymentsEnvironment: "SIMULATED";
}

interface ReportLike {
  kind?: string;
  generatedAt?: string;
  denominator?: number;
  passed?: number;
  environment?: { agentMode?: string; model?: string | null };
  usage?: { tokensReported?: boolean; totalInputTokens?: number; totalOutputTokens?: number };
  gate?: { mode?: string; ok?: boolean };
  provenance?: Partial<Provenance>;
}

export type LiveStatus = "NOT_RUN" | "NOT_VERIFIED" | "VERIFIED";
export interface LiveAssessment { status: LiveStatus; reasons: string[]; summary: string }

/** Decides whether an eval-live.json report may be described as a successful real-model run. */
export function assessLiveReport(raw: unknown, changedSince: (commit: string) => string[] = sourceChangedSince): LiveAssessment {
  if (raw === null || raw === undefined) return { status: "NOT_RUN", reasons: ["no live evaluation report exists"], summary: "Real-model evaluation: NOT RUN." };
  const r = raw as ReportLike;
  const why: string[] = [];
  if (r.kind !== "live-model") why.push(`report kind is "${String(r.kind)}", not live-model`);
  if (r.environment?.agentMode !== "LIVE") why.push("agent mode was not LIVE");
  if (!r.environment?.model) why.push("no model identifier recorded");
  const p = r.provenance;
  if (!p || p.schema !== 1) why.push("report has no provenance block (legacy or hand-made file)");
  else {
    if (p.driver !== "live-adapter") why.push(`driver was "${String(p.driver)}"`);
    if (p.endpoint !== "provider-default") why.push(`provider endpoint was "${String(p.endpoint)}" (a custom endpoint, e.g. a local fake, is not a real-model run)`);
    if (p.parameters?.reportOnly) why.push("run was report-only (observational), not a release gate");
    if (!p.sourceCommit) why.push("no source commit recorded");
    else {
      const changed = changedSince(p.sourceCommit);
      if (changed.length) why.push(`source changed since the run (${changed.slice(0, 3).join(", ")}${changed.length > 3 ? ", ..." : ""}); the report is stale`);
    }
    if (p.sourceDirty) why.push("the run was made on a dirty source tree");
  }
  if (!r.denominator || r.denominator < 1) why.push("no cases were run");
  if (r.gate?.ok !== true) why.push("the release gate did not pass");
  if (typeof r.passed === "number" && typeof r.denominator === "number" && r.passed < r.denominator) why.push(`${r.denominator - r.passed} of ${r.denominator} cases failed`);
  if (!r.usage?.tokensReported || !((r.usage.totalInputTokens ?? 0) > 0)) why.push("no provider-reported token usage");
  if (why.length) {
    return { status: "NOT_VERIFIED", reasons: why, summary: `Real-model evaluation: NOT VERIFIED (a report file exists but does not qualify: ${why[0]}).` };
  }
  return {
    status: "VERIFIED", reasons: [],
    summary: `Real-model evaluation: ${r.passed}/${r.denominator} cases passed on model ${r.environment!.model} at source commit ${String(p!.sourceCommit).slice(0, 7)} (${r.generatedAt}); provider-reported usage recorded.`,
  };
}

/** A deterministic report is acceptable as fresh evidence only if it was just produced by a passing release-gate run. */
export function assessMockReport(raw: unknown, opts: { notBefore: number; expectCases?: number }): string[] {
  const r = raw as ReportLike | null;
  const why: string[] = [];
  if (!r) return ["report is missing or unreadable"];
  if (r.kind !== "deterministic-mock") why.push(`unexpected report kind "${String(r.kind)}"`);
  if (r.provenance?.driver !== "deterministic-mock+scripted") why.push("report provenance does not say deterministic-mock+scripted");
  if (r.provenance?.parameters?.reportOnly) why.push("report was produced in report-only mode");
  const at = Date.parse(r.generatedAt ?? "");
  if (Number.isNaN(at) || at < opts.notBefore) why.push("report was not generated by this run (stale)");
  if (!r.denominator || (opts.expectCases && r.denominator !== opts.expectCases)) why.push(`unexpected case count ${String(r.denominator)}`);
  if (r.gate?.ok !== true || r.gate?.mode !== "release-gate") why.push("the release gate did not pass");
  return why;
}

export interface MandatoryEvalOptions {
  /** Command that must write eval-mock.json into APP_EVAL_OUT_DIR. Overridable for tests only. */
  command?: string[];
  env?: Record<string, string>;
  startedAt?: number;
  expectCases?: number;
}

/**
 * Runs the deterministic evaluation as a required step. A non-zero exit, a missing, stale or non-passing report
 * throws; the caller must not export anything on failure. The fresh report is returned (path inside a temp dir).
 */
export function runMandatoryEval(opts: MandatoryEvalOptions = {}): { reportPath: string; report: unknown } {
  const startedAt = opts.startedAt ?? Date.now();
  const dir = mkdtempSync(join(tmpdir(), "tb-evidence-eval-"));
  const [cmd, ...args] = opts.command ?? [process.execPath, "--import", "tsx", "scripts/eval/run.ts"];
  const r = spawnSync(cmd, args, { encoding: "utf8", env: { ...process.env, ...opts.env, APP_EVAL_OUT_DIR: dir }, maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) {
    const tail = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").slice(-12).join("\n");
    throw new Error(`Mandatory evaluation failed (exit ${String(r.status)}). Nothing was exported.\n${tail}`);
  }
  const reportPath = join(dir, "eval-mock.json");
  if (!existsSync(reportPath)) throw new Error("Mandatory evaluation produced no eval-mock.json. Nothing was exported.");
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as unknown;
  const problems = assessMockReport(report, { notBefore: startedAt - 1000, expectCases: opts.expectCases });
  if (problems.length) throw new Error(`Evaluation report is not valid fresh evidence: ${problems.join("; ")}. Nothing was exported.`);
  return { reportPath, report };
}

export function copyInto(src: string, outDir: string, name: string): void {
  mkdirSync(outDir, { recursive: true });
  copyFileSync(src, join(outDir, name));
}

export interface EvidenceBundle {
  manifest: { sourceCommit?: string | null; sourceDirty?: boolean };
  testSummary: { sourceCommit?: string | null; sourceDirty?: boolean; typecheck?: string; unitAndIntegration?: { failed?: number }; browser?: { failed?: number } };
  evalMock: { provenance?: { sourceCommit?: string | null; sourceDirty?: boolean }; gate?: { ok?: boolean } };
}

/**
 * Returns the reasons a set of artifacts cannot be traced to one clean source commit (empty list = consistent).
 * Artifacts may be committed later than the sources they describe; sources must not have changed in between.
 */
export function checkEvidenceConsistency(b: EvidenceBundle, changedSince: (commit: string) => string[] = sourceChangedSince): string[] {
  const why: string[] = [];
  const commits = {
    "evidence manifest": b.manifest.sourceCommit, "test summary": b.testSummary.sourceCommit, "evaluation report": b.evalMock.provenance?.sourceCommit,
  };
  for (const [k, v] of Object.entries(commits)) if (!v) why.push(`${k} records no source commit`);
  const distinct = new Set(Object.values(commits).filter(Boolean));
  if (distinct.size > 1) why.push(`artifacts come from different source commits (${[...distinct].map((c) => String(c).slice(0, 7)).join(", ")})`);
  if (b.manifest.sourceDirty || b.testSummary.sourceDirty || b.evalMock.provenance?.sourceDirty) why.push("an artifact was generated from a dirty source tree");
  if (b.testSummary.typecheck !== "pass" || b.testSummary.unitAndIntegration?.failed !== 0 || b.testSummary.browser?.failed !== 0) why.push("the test summary records a failure");
  if (b.evalMock.gate?.ok !== true) why.push("the evaluation gate did not pass");
  const commit = [...distinct][0];
  if (commit) {
    const changed = changedSince(String(commit));
    if (changed.length) why.push(`source changed after the artifacts were generated (${changed.slice(0, 3).join(", ")}${changed.length > 3 ? ", ..." : ""})`);
  }
  return why;
}
