// The optional real-model pack is validated here WITHOUT any real model: with the MOCK agent for the expectations,
// and end to end against a local fake provider for the spending ceilings and the release gate.
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FLOWS } from "../scripts/eval/flows";
import { Harness } from "../scripts/eval/harness";
import { MockLlm } from "../src/server/agent/mock-llm";
import { parseBoundedInt } from "../scripts/eval/gate";

interface PackCase { id: string; scenario: string; flow: string; params: Record<string, unknown>; expect: Record<string, unknown>; critical?: boolean }
const pack = JSON.parse(readFileSync("eval/live-pack.json", "utf8")) as { pack: string; cases: PackCase[] };

describe("live pack definition", () => {
  it("covers the five required situations", () => {
    expect(pack.cases.map((c) => c.flow)).toEqual(["agent_plan", "start_only", "agent_plan", "live_cancel", "adapter_unreachable"]);
    expect(pack.cases.some((c) => c.critical)).toBe(true);
  });
  it.each(pack.cases.map((c) => [c.id, c] as const))("%s: expectations hold with the MOCK agent (no model call, no spend)", async (_id, c) => {
    const h = new Harness(c.scenario as never);
    const observed = await FLOWS[c.flow](h, { id: c.id, flow: c.flow, scenario: c.scenario, params: c.params }, () => new MockLlm());
    for (const [k, v] of Object.entries(c.expect)) {
      if (k === "errorContains") expect(String(observed[k])).toContain(String(v));
      else expect(observed[k], k).toEqual(v);
    }
    expect(h.invariantViolations()).toEqual([]);
  });
});

describe("bounded flags", () => {
  it("rejects out-of-range values", () => {
    expect(parseBoundedInt([], "max-total-tokens", 120000, 1000, 1000000)).toBe(120000);
    for (const bad of ["0", "abc", "999", "9999999"]) expect(() => parseBoundedInt([`--max-total-tokens=${bad}`], "max-total-tokens", 1, 1000, 1000000)).toThrow(/max-total-tokens/);
  });
});

let server: Server | null = null;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));
function fakeProvider(reply: () => { status: number; json: unknown }): Promise<string> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      req.resume();
      req.on("end", () => { const o = reply(); res.writeHead(o.status, { "content-type": "application/json" }); res.end(JSON.stringify(o.json)); });
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

describe("live pack against a local fake provider", () => {
  it("records reported usage, enforces the total token ceiling, and cannot pass the release gate", async () => {
    const url = await fakeProvider(() => ({ status: 200, json: { id: "msg_1", type: "message", role: "assistant", model: "fake", content: [{ type: "text", text: "I have nothing to do." }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1500, output_tokens: 500 } } }));
    const dir = mkdtempSync(join(tmpdir(), "tb-pack-"));
    const r = await runEval(["--live", "--max-total-tokens=1000"], { APP_EVAL_LIVE: "1", APP_LLM_API_KEY: "fake-key-for-test", APP_LLM_MODEL: "fake-model", APP_LLM_BASE_URL: url, APP_EVAL_OUT_DIR: dir });
    expect(r.code).toBe(1);
    const rep = JSON.parse(readFileSync(join(dir, "eval-live.json"), "utf8"));
    expect(rep.provenance).toMatchObject({ driver: "live-adapter", endpoint: "custom-override" });
    expect(rep.provenance.parameters).toMatchObject({ pack: "live-v1", maxTotalTokens: 1000 });
    const byId = Object.fromEntries(rep.cases.map((c: { id: string }) => [c.id, c]));
    expect(byId["live-01"].tokens).toEqual({ input: 1500, output: 500 }); // the usage the (fake) provider reported
    expect(byId["live-01"].passed).toBe(false); // the model did nothing useful
    expect(byId["live-02"].error).toMatch(/SKIPPED/); // ceiling reached after the first case
    expect(rep.gate.ok).toBe(false);
  }, 90_000);
  it("cases that need no model still pass, while model-dependent ones fail when the provider rejects everything", async () => {
    const url = await fakeProvider(() => ({ status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "nope" } } }));
    const dir = mkdtempSync(join(tmpdir(), "tb-pack-"));
    const r = await runEval(["--live"], { APP_EVAL_LIVE: "1", APP_LLM_API_KEY: "fake-key-for-test", APP_LLM_MODEL: "fake-model", APP_LLM_BASE_URL: url, APP_EVAL_OUT_DIR: dir });
    expect(r.code).toBe(1);
    const rep = JSON.parse(readFileSync(join(dir, "eval-live.json"), "utf8"));
    const passed = rep.cases.filter((c: { passed: boolean }) => c.passed).map((c: { id: string }) => c.id).sort();
    expect(passed).toEqual(["live-02", "live-04", "live-05"]);
  }, 90_000);
});
