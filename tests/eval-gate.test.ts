// The evaluation exit code must be able to fail a release. No real model is used: a local fake provider
// answers every request with an error, so the adapter, harness and gate run end to end without any spend.
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateGate, parseMaxCases } from "../scripts/eval/gate";

const ok = { passed: true, critical: false, invariantViolations: [] as string[] };

describe("evaluation gate (pure)", () => {
  it("a failing live case fails the release gate; report-only mode never gates but still reports ok=false", () => {
    const results = [ok, { ...ok, passed: false }];
    expect(evaluateGate({ live: true, results, unauthorizedPayments: 0, reportOnly: false })).toMatchObject({ ok: false, exitCode: 1 });
    expect(evaluateGate({ live: true, results, unauthorizedPayments: 0, reportOnly: true })).toMatchObject({ ok: false, exitCode: 0, mode: "report-only" });
  });
  it("an empty selection cannot pass", () => {
    expect(evaluateGate({ live: true, results: [], unauthorizedPayments: 0, reportOnly: false })).toMatchObject({ ok: false, exitCode: 1 });
    expect(evaluateGate({ live: false, results: [], unauthorizedPayments: 0, reportOnly: false }).ok).toBe(false);
  });
  it("critical failures, invariant violations and unauthorized payments each fail the gate", () => {
    const many = Array.from({ length: 30 }, () => ok);
    expect(evaluateGate({ live: false, results: many, unauthorizedPayments: 0, reportOnly: false }).ok).toBe(true);
    expect(evaluateGate({ live: false, results: [{ ...ok, critical: true, passed: false }, ...many.slice(1)], unauthorizedPayments: 0, reportOnly: false }).ok).toBe(false);
    expect(evaluateGate({ live: false, results: [{ ...ok, invariantViolations: ["X"] }, ...many.slice(1)], unauthorizedPayments: 0, reportOnly: false }).ok).toBe(false);
    expect(evaluateGate({ live: false, results: many, unauthorizedPayments: 1, reportOnly: false }).ok).toBe(false);
  });
  it("a live run passes only if every selected case passes", () => {
    expect(evaluateGate({ live: true, results: [ok, ok, ok], unauthorizedPayments: 0, reportOnly: false }).ok).toBe(true);
  });
  it("--max-cases must be a bounded positive integer", () => {
    expect(parseMaxCases([])).toBe(6);
    expect(parseMaxCases(["--max-cases=3"])).toBe(3);
    for (const bad of ["0", "-1", "abc", "1.5", "", "31", "999999"]) expect(() => parseMaxCases([`--max-cases=${bad}`]), bad).toThrow(/max-cases/);
  });
});

let server: Server | null = null;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

function fakeProvider(): Promise<string> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      req.resume();
      req.on("end", () => { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "fake provider rejects everything" } })); });
    }).listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server!.address() as AddressInfo).port}`));
  });
}

function runEval(args: string[], env: Record<string, string>): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/eval/run.ts", ...args], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
}

describe("evaluation runner exit status (fake provider, no spend)", () => {
  it("live cases that fail make the command fail, and the full result is still written", async () => {
    const url = await fakeProvider();
    const dir = mkdtempSync(join(tmpdir(), "tb-eval-"));
    const env = { APP_EVAL_LIVE: "1", APP_LLM_API_KEY: "fake-key-for-test", APP_LLM_MODEL: "fake-model", APP_LLM_BASE_URL: url, APP_EVAL_OUT_DIR: dir };
    const r = await runEval(["--live", "--max-cases=2"], env);
    expect(r.code).toBe(1);
    const report = JSON.parse(readFileSync(join(dir, "eval-live.json"), "utf8"));
    expect(report.denominator).toBe(2);
    // The default pack's second case is refused by the server before any model call, so it passes even with a dead provider.
    expect(report.cases.map((c: { id: string; passed: boolean }) => [c.id, c.passed])).toEqual([["live-01", false], ["live-02", true]]);
    expect(report.passed).toBe(1);
    expect(report.gate).toMatchObject({ mode: "release-gate", ok: false });
    // Observational mode is explicit, still records the failure, and does not gate.
    const dir2 = mkdtempSync(join(tmpdir(), "tb-eval-"));
    const r2 = await runEval(["--live", "--max-cases=1", "--report-only"], { ...env, APP_EVAL_OUT_DIR: dir2 });
    expect(r2.code).toBe(0);
    expect(JSON.parse(readFileSync(join(dir2, "eval-live.json"), "utf8")).gate).toMatchObject({ mode: "report-only", ok: false });
  }, 60_000);
  it("an invalid sample size is rejected before anything runs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tb-eval-"));
    for (const bad of ["0", "abc", "100"]) {
      const r = await runEval(["--live", `--max-cases=${bad}`], { APP_EVAL_LIVE: "1", APP_LLM_API_KEY: "fake-key-for-test", APP_LLM_MODEL: "fake-model", APP_LLM_BASE_URL: "http://127.0.0.1:1", APP_EVAL_OUT_DIR: dir });
      expect(r.code, bad).toBe(2);
      expect(r.out).toMatch(/max-cases/);
    }
  }, 60_000);
});
