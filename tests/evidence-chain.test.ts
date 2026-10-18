// The evidence chain must not turn failed, stale, fake or mock runs into claims. All reports live in temp dirs.
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { assessLiveReport, assessMockReport, checkEvidenceConsistency, runMandatoryEval } from "../scripts/lib/provenance";

const noChange = () => [] as string[];
const goodLive = () => ({
  kind: "live-model", generatedAt: "2026-10-18T12:00:00.000Z", denominator: 6, passed: 6,
  environment: { agentMode: "LIVE", model: "some-model-id", payments: "SIMULATED" },
  usage: { tokensReported: true, totalInputTokens: 1200, totalOutputTokens: 300 },
  gate: { mode: "release-gate", ok: true, failures: [], exitCode: 0 },
  provenance: { schema: 1, driver: "live-adapter", endpoint: "provider-default", sourceCommit: "a".repeat(40), sourceDirty: false, runAt: "2026-10-18T12:00:00.000Z",
    parameters: { live: true, maxCases: 6, reportOnly: false, casesVersion: "1", taskTokenBudgetCap: 40000 }, paymentsEnvironment: "SIMULATED" },
});

describe("live report assessment", () => {
  it("no file means NOT_RUN", () => {
    expect(assessLiveReport(null).status).toBe("NOT_RUN");
  });
  it("a complete report from the default endpoint with usage, a passing gate and unchanged sources is VERIFIED", () => {
    const a = assessLiveReport(goodLive(), noChange);
    expect(a.status).toBe("VERIFIED");
    expect(a.summary).toContain("6/6");
  });
  it("a local fake provider (custom endpoint) never verifies, even if it 'passed'", () => {
    const r = goodLive();
    r.provenance.endpoint = "custom-override";
    const a = assessLiveReport(r, noChange);
    expect(a.status).toBe("NOT_VERIFIED");
    expect(a.reasons.join(" ")).toMatch(/custom endpoint/);
  });
  it.each([
    ["a MOCK report", (r: ReturnType<typeof goodLive>) => { r.kind = "deterministic-mock"; r.environment.agentMode = "MOCK"; }],
    ["an empty report", (r: ReturnType<typeof goodLive>) => { r.denominator = 0; r.passed = 0; }],
    ["a failed run", (r: ReturnType<typeof goodLive>) => { r.passed = 4; r.gate.ok = false; }],
    ["no reported usage", (r: ReturnType<typeof goodLive>) => { r.usage.tokensReported = false; r.usage.totalInputTokens = 0; }],
    ["a report-only run", (r: ReturnType<typeof goodLive>) => { r.provenance.parameters.reportOnly = true; r.gate.mode = "report-only"; }],
    ["a dirty source tree", (r: ReturnType<typeof goodLive>) => { r.provenance.sourceDirty = true; }],
    ["no model id", (r: ReturnType<typeof goodLive>) => { (r.environment as { model: string | null }).model = null; }],
  ])("%s is NOT_VERIFIED", (_name, mutate) => {
    const r = goodLive();
    mutate(r);
    expect(assessLiveReport(r, noChange).status).toBe("NOT_VERIFIED");
  });
  it("a legacy report without provenance is NOT_VERIFIED", () => {
    const r: Record<string, unknown> = goodLive();
    delete r.provenance;
    expect(assessLiveReport(r, noChange).status).toBe("NOT_VERIFIED");
  });
  it("a report whose sources have since changed is stale", () => {
    const a = assessLiveReport(goodLive(), () => ["src/server/agent/runner.ts"]);
    expect(a.status).toBe("NOT_VERIFIED");
    expect(a.reasons.join(" ")).toMatch(/stale/);
  });
});

const node = process.execPath;
describe("mandatory evaluation step", () => {
  it("a failing evaluation command aborts with an error", () => {
    expect(() => runMandatoryEval({ command: [node, "-e", "process.exit(1)"] })).toThrow(/Nothing was exported/);
  });
  it("success exit code but no report is rejected", () => {
    expect(() => runMandatoryEval({ command: [node, "-e", "0"] })).toThrow(/no eval-mock\.json/);
  });
  it("a stale report (generated before this run) is rejected", () => {
    const stale = JSON.stringify({ kind: "deterministic-mock", generatedAt: "2020-01-01T00:00:00.000Z", denominator: 30, gate: { ok: true, mode: "release-gate" }, provenance: { driver: "deterministic-mock+scripted" } });
    const script = `require("fs").writeFileSync(require("path").join(process.env.APP_EVAL_OUT_DIR,"eval-mock.json"), ${JSON.stringify(stale)})`;
    expect(() => runMandatoryEval({ command: [node, "-e", script], expectCases: 30 })).toThrow(/stale/);
  });
  it("a report whose gate failed is rejected even if the process exited 0 (report-only)", () => {
    const rep = JSON.stringify({ kind: "deterministic-mock", generatedAt: new Date(Date.now() + 5000).toISOString(), denominator: 30, gate: { ok: false, mode: "report-only" }, provenance: { driver: "deterministic-mock+scripted", parameters: { reportOnly: true } } });
    const script = `require("fs").writeFileSync(require("path").join(process.env.APP_EVAL_OUT_DIR,"eval-mock.json"), ${JSON.stringify(rep)})`;
    expect(() => runMandatoryEval({ command: [node, "-e", script], expectCases: 30 })).toThrow(/release gate|report-only/);
  });
  it("a fresh passing report is accepted", () => {
    const rep = JSON.stringify({ kind: "deterministic-mock", generatedAt: new Date(Date.now() + 5000).toISOString(), denominator: 30, gate: { ok: true, mode: "release-gate" }, provenance: { driver: "deterministic-mock+scripted", parameters: { reportOnly: false } } });
    const script = `require("fs").writeFileSync(require("path").join(process.env.APP_EVAL_OUT_DIR,"eval-mock.json"), ${JSON.stringify(rep)})`;
    const r = runMandatoryEval({ command: [node, "-e", script], expectCases: 30 });
    expect(existsSync(r.reportPath)).toBe(true);
    expect(assessMockReport(JSON.parse(readFileSync(r.reportPath, "utf8")), { notBefore: 0, expectCases: 30 })).toEqual([]);
  });
});

describe("fake-provider report cannot become a deck claim", () => {
  it("running the real eval runner against a local fake endpoint yields NOT_VERIFIED", () => {
    // Even a gate-passing run against a custom endpoint is excluded; here the fake rejects everything, and the
    // report is written to a temp dir and assessed with the same function the deck uses.
    const dir = mkdtempSync(join(tmpdir(), "tb-fakeprov-"));
    const r = spawnSync(node, ["--import", "tsx", "scripts/eval/run.ts", "--live", "--max-cases=1", "--report-only"], {
      encoding: "utf8",
      env: { ...process.env, APP_EVAL_LIVE: "1", APP_LLM_API_KEY: "fake-key-for-test", APP_LLM_MODEL: "fake-model", APP_LLM_BASE_URL: "http://127.0.0.1:1", APP_EVAL_OUT_DIR: dir },
    });
    expect(r.status).toBe(0);
    const report = JSON.parse(readFileSync(join(dir, "eval-live.json"), "utf8"));
    expect(report.provenance.endpoint).toBe("custom-override");
    const a = assessLiveReport(report, noChange);
    expect(a.status).toBe("NOT_VERIFIED");
    writeFileSync(join(dir, "note.txt"), a.summary);
  }, 60_000);
});

describe("package provenance consistency", () => {
  const C = "c".repeat(40);
  const good = () => ({
    manifest: { sourceCommit: C, sourceDirty: false },
    testSummary: { sourceCommit: C, sourceDirty: false, typecheck: "pass", unitAndIntegration: { failed: 0 }, browser: { failed: 0 } },
    evalMock: { provenance: { sourceCommit: C, sourceDirty: false }, gate: { ok: true } },
  });
  it("accepts artifacts from one clean commit with unchanged sources", () => {
    expect(checkEvidenceConsistency(good(), noChange)).toEqual([]);
  });
  it("rejects mixed commits, dirty trees, failures, a failed gate and later source changes", () => {
    const mixed = good(); mixed.testSummary.sourceCommit = "d".repeat(40);
    expect(checkEvidenceConsistency(mixed, noChange).join(" ")).toMatch(/different source commits/);
    const dirty = good(); dirty.manifest.sourceDirty = true;
    expect(checkEvidenceConsistency(dirty, noChange).join(" ")).toMatch(/dirty/);
    const failed = good(); failed.testSummary.browser.failed = 1;
    expect(checkEvidenceConsistency(failed, noChange).join(" ")).toMatch(/failure/);
    const gate = good(); gate.evalMock.gate.ok = false;
    expect(checkEvidenceConsistency(gate, noChange).join(" ")).toMatch(/gate/);
    expect(checkEvidenceConsistency(good(), () => ["src/server/agent/runner.ts"]).join(" ")).toMatch(/source changed/);
    const none = good(); (none.manifest as { sourceCommit: string | null }).sourceCommit = null;
    expect(checkEvidenceConsistency(none, noChange).join(" ")).toMatch(/records no source commit/);
  });
});
