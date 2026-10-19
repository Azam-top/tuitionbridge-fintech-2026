import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenAiCompatibleLlm } from "../src/server/agent/openai-compatible-llm.js";
import { AnthropicLlm } from "../src/server/agent/anthropic-llm.js";
import { createLlm } from "../src/server/agent/factory.js";
import { agentMode, agentStatus, loadConfig } from "../src/server/config.js";
import { LlmError, type LlmRequest } from "../src/server/agent/types.js";
import { TOOL_SPECS } from "../src/server/agent/tools.js";
import { createRunner, getTask } from "../src/server/agent/runner.js";
import { confirmInvoice, listInvoices } from "../src/server/services/invoices.js";
import { buildApp } from "../src/server/http/app.js";
import { ALICE, makeCtx } from "./helpers.js";
import { EN } from "./agent-helpers.js";

// A local stand-in for the Groq HTTP API. It verifies OUR adapter and the tool-calling cycle through the real runner and tools.
// It is NOT evidence that a real model works: see scripts/live-smoke.ts for that.
const KEY = "gsk_test_key_never_real_0123456789";
let server: Server | null = null;
afterEach(() => new Promise<void>((r) => { const s = server; server = null; s ? s.close(() => r()) : r(); }));

interface Seen { path: string; headers: Record<string, string | string[] | undefined>; body: Record<string, any> }
type Reply = { status?: number; headers?: Record<string, string>; json?: unknown; raw?: string; delayMs?: number };

function fake(handler: (body: Record<string, any>, n: number) => Reply) {
  return new Promise<{ url: string; seen: Seen[] }>((resolve) => {
    const seen: Seen[] = [];
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (d) => (raw += d));
      req.on("end", () => {
        const body = JSON.parse(raw || "{}") as Record<string, any>;
        seen.push({ path: req.url ?? "", headers: req.headers, body });
        const out = handler(body, seen.length);
        setTimeout(() => {
          res.writeHead(out.status ?? 200, { "content-type": "application/json", ...(out.headers ?? {}) });
          res.end(out.raw ?? JSON.stringify(out.json ?? {}));
        }, out.delayMs ?? 0);
      });
    }).listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(server!.address() as AddressInfo).port}/openai/v1`, seen }));
  });
}

const chat = (message: Record<string, unknown>, finish = "stop", usage: unknown = { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 }) =>
  ({ id: "chatcmpl-1", object: "chat.completion", model: "openai/gpt-oss-120b", choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason: finish }], usage });
const call = (id: string, name: string, args: unknown) => ({ id, type: "function", function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) } });

const req = (): LlmRequest => ({
  system: "sys", maxTokens: 123,
  tools: [TOOL_SPECS.get_balances, TOOL_SPECS.evaluate_routes],
  messages: [
    { role: "user", text: "hello" },
    { role: "assistant", text: "", toolCalls: [{ id: "call_1", name: "get_balances", input: {} }, { id: "call_2", name: "evaluate_routes", input: { preference: "cheapest", reserve_usd_cents: "30000" } }] },
    { role: "tool", results: [{ id: "call_1", name: "get_balances", content: "{\"ok\":true}", isError: false }, { id: "call_2", name: "evaluate_routes", content: "{\"error\":{\"code\":\"X\"}}", isError: true }] },
  ],
});
const make = (url: string, o: { timeoutMs?: number; reasoningEffort?: "low" | "medium" | "high" | null } = {}) =>
  new OpenAiCompatibleLlm(KEY, "openai/gpt-oss-120b", { baseUrl: url, providerLabel: "Groq", ...o });

describe("Groq (OpenAI-compatible) adapter, against a local fake provider", () => {
  it("sends the documented chat-completions tool-calling shape with a server-side key", async () => {
    const f = await fake(() => ({ json: chat({ content: "Hi", tool_calls: [call("call_9", "evaluate_routes", { preference: "cheapest", reserve_usd_cents: "30000" })] }, "tool_calls") }));
    const turn = await make(f.url).complete(req());
    expect(turn).toMatchObject({ text: "Hi", stop: "tool_use", usage: { inputTokens: 11, outputTokens: 7 } });
    expect(turn.toolCalls).toEqual([{ id: "call_9", name: "evaluate_routes", input: { preference: "cheapest", reserve_usd_cents: "30000" } }]);
    const { path, headers, body } = f.seen[0];
    expect(path).toBe("/openai/v1/chat/completions");
    expect(headers.authorization).toBe(`Bearer ${KEY}`);
    expect(body.model).toBe("openai/gpt-oss-120b");
    expect(body.max_completion_tokens).toBe(123);
    expect(body.max_tokens).toBeUndefined();
    expect(body.include_reasoning).toBe(false);
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.tool_choice).toBe("auto");
    expect(body.tools.map((t: any) => [t.type, t.function.name])).toEqual([["function", "get_balances"], ["function", "evaluate_routes"]]);
    expect(body.tools[1].function.parameters).toEqual(TOOL_SPECS.evaluate_routes.inputSchema);
    expect(body.messages.map((m: any) => m.role)).toEqual(["system", "user", "assistant", "tool", "tool"]);
    expect(body.messages[2].content).toBeNull();
    expect(body.messages[2].tool_calls[1]).toEqual({ id: "call_2", type: "function", function: { name: "evaluate_routes", arguments: "{\"preference\":\"cheapest\",\"reserve_usd_cents\":\"30000\"}" } });
    expect(body.messages[3]).toEqual({ role: "tool", tool_call_id: "call_1", name: "get_balances", content: "{\"ok\":true}" });
    expect(body.messages[4].tool_call_id).toBe("call_2");
  });
  it("sends reasoning_effort only when configured", async () => {
    const f = await fake(() => ({ json: chat({ content: "ok" }) }));
    await make(f.url, { reasoningEffort: "low" }).complete(req());
    expect(f.seen[0].body.reasoning_effort).toBe("low");
  });
  it("maps finish reasons, reports no usage when absent, and never surfaces hidden reasoning", async () => {
    const f = await fake((_b, n) => ({ json: n === 1 ? chat({ content: "cut", reasoning: "SECRET-CHAIN" }, "length", null) : chat({ content: "no" }, "content_filter") }));
    const a = await make(f.url).complete(req());
    expect(a).toMatchObject({ stop: "max_tokens", usage: null, text: "cut" });
    expect(JSON.stringify(a)).not.toContain("SECRET-CHAIN");
    expect((await make(f.url).complete(req())).stop).toBe("refusal");
  });
  it("passes unparseable or non-object tool arguments on as a string so the tool validation rejects them", async () => {
    const f = await fake(() => ({ json: chat({ content: null, tool_calls: [call("a", "evaluate_routes", "{not json"), call("b", "get_balances", "[1,2]"), call("c", "get_balances", ""), { type: "function", function: { name: "get_quotes", arguments: "{}" } }] }, "tool_calls") }));
    const turn = await make(f.url).complete(req());
    expect(turn.toolCalls.map((c) => c.input)).toEqual(["{not json", "[1,2]", {}, {}]);
    expect(turn.toolCalls[3].id).toBe("call_3"); // a missing provider id is replaced, never trusted blank
  });
  it("treats an invalid or empty provider response as a transient error", async () => {
    for (const raw of ["<html>bad gateway</html>", "{}", JSON.stringify({ choices: [] })]) {
      const f = await fake(() => ({ raw }));
      const e = await make(f.url).complete(req()).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(LlmError);
      expect((e as LlmError).transient).toBe(true);
      await new Promise<void>((r) => server!.close(() => r()));
      server = null;
    }
  });
  it("classifies HTTP errors without leaking the key or the body", async () => {
    const cases: [number, string | undefined, boolean][] = [[429, "2", true], [500, undefined, true], [503, undefined, true], [408, undefined, true], [422, undefined, true], [401, undefined, false], [400, undefined, false], [403, undefined, false], [404, undefined, false]];
    for (const [status, retryAfter, transient] of cases) {
      const f = await fake(() => ({ status, headers: retryAfter ? { "retry-after": retryAfter } as Record<string, string> : {}, json: { error: { message: `detail ${KEY}`, type: "x" } } }));
      const e = (await make(f.url).complete(req()).catch((x: unknown) => x)) as LlmError;
      expect(e).toBeInstanceOf(LlmError);
      expect(e.transient, String(status)).toBe(transient);
      expect(e.message).not.toContain(KEY);
      expect(e.message).not.toContain("detail");
      if (status === 429) expect(e.retryAfterMs).toBe(2000);
      await new Promise<void>((r) => server!.close(() => r()));
      server = null;
    }
  });
  it("retries a failed tool call (400 tool_use_failed) but not other 400s", async () => {
    const f = await fake((_b, n) => ({ status: 400, json: { error: { message: "Failed to call a function", type: "invalid_request_error", code: n === 1 ? "tool_use_failed" : "other", failed_generation: "<secret generation>" } } }));
    const e1 = (await make(f.url).complete(req()).catch((x: unknown) => x)) as LlmError;
    const e2 = (await make(f.url).complete(req()).catch((x: unknown) => x)) as LlmError;
    expect(e1.transient).toBe(true);
    expect(e1.message).not.toContain("secret generation");
    expect(e2.transient).toBe(false);
  });
  it("does not wait out a rate limit that asks for a long pause (daily quota)", async () => {
    const f = await fake(() => ({ status: 429, headers: { "retry-after": "1200" }, json: { error: { message: "TPD" } } }));
    const e = (await make(f.url).complete(req()).catch((x: unknown) => x)) as LlmError;
    expect(e.transient).toBe(false);
    expect(e.message).toMatch(/rate limit.*1200 s/);
  });
  it("times out a silent provider (transient) and treats an unreachable host as transient", async () => {
    const f = await fake(() => ({ json: chat({ content: "late" }), delayMs: 400 }));
    const e = (await make(f.url, { timeoutMs: 100 }).complete(req()).catch((x: unknown) => x)) as LlmError;
    expect(e).toBeInstanceOf(LlmError);
    expect(e.transient).toBe(true);
    expect(e.message).toMatch(/did not answer/);
    const g = (await make("http://127.0.0.1:1/openai/v1", { timeoutMs: 2000 }).complete(req()).catch((x: unknown) => x)) as LlmError;
    expect(g.transient).toBe(true);
    expect(g.message).not.toContain(KEY);
  });
});

describe("provider selection and .env loading", () => {
  const base = { APP_MODE: "live", APP_LLM_API_KEY: KEY, APP_LLM_MODEL: "openai/gpt-oss-120b" };
  it("defaults to anthropic, selects groq, and rejects unknown providers without any fallback", () => {
    expect(loadConfig({ ...base }).llmProvider).toBe("anthropic");
    expect(createLlm(loadConfig({ ...base }))).toBeInstanceOf(AnthropicLlm);
    const groq = loadConfig({ ...base, APP_LLM_PROVIDER: " Groq " });
    expect(groq.llmProvider).toBe("groq");
    expect(agentStatus(groq)).toBe("LIVE");
    expect(createLlm(groq)).toBeInstanceOf(OpenAiCompatibleLlm);
    const odd = loadConfig({ ...base, APP_LLM_PROVIDER: "openai" });
    expect(odd.llmProvider).toBe("unsupported");
    expect(agentStatus(odd)).toBe("NOT_CONFIGURED");
    expect(agentMode(odd)).toBe("MOCK");
    expect(createLlm(odd)).not.toBeInstanceOf(AnthropicLlm);
    expect(createLlm(odd)).not.toBeInstanceOf(OpenAiCompatibleLlm);
    // Missing key or model: still setup required in the live mode, for either provider.
    expect(agentStatus(loadConfig({ APP_MODE: "live", APP_LLM_PROVIDER: "groq", APP_LLM_MODEL: "m" }))).toBe("NOT_CONFIGURED");
    expect(agentStatus(loadConfig({ APP_MODE: "live", APP_LLM_PROVIDER: "groq", APP_LLM_API_KEY: KEY }))).toBe("NOT_CONFIGURED");
  });
  it("reads the model settings from a .env file via process.loadEnvFile", () => {
    const dir = mkdtempSync(join(tmpdir(), "tb-env-"));
    const file = join(dir, ".env");
    writeFileSync(file, `APP_LLM_PROVIDER=groq\nAPP_LLM_API_KEY=${KEY}\nAPP_LLM_MODEL=openai/gpt-oss-120b\nAPP_LLM_REASONING_EFFORT=low\n`);
    const names = ["APP_LLM_PROVIDER", "APP_LLM_API_KEY", "APP_LLM_MODEL", "APP_LLM_REASONING_EFFORT"];
    const saved = names.map((n) => [n, process.env[n]] as const);
    for (const n of names) delete process.env[n];
    try {
      process.loadEnvFile(file);
      const c = loadConfig();
      expect(c).toMatchObject({ llmProvider: "groq", llmModel: "openai/gpt-oss-120b", llmApiKey: KEY, llmReasoningEffort: "low" });
      expect(agentStatus({ ...c, appMode: "live" })).toBe("LIVE");
    } finally {
      for (const [n, v] of saved) { if (v === undefined) delete process.env[n]; else process.env[n] = v; }
    }
  });
});

describe("the public config never carries the key", () => {
  it("exposes the model id but not the key or the provider endpoint", async () => {
    const ctx = makeCtx("standard", { APP_MODE: "live", APP_LLM_PROVIDER: "groq", APP_LLM_API_KEY: KEY, APP_LLM_MODEL: "openai/gpt-oss-120b" });
    const app = buildApp({ ctx, runner: createRunner(ctx, createLlm(ctx.config)), llm: createLlm(ctx.config), webDir: "/nonexistent" });
    const r = await app.inject({ method: "GET", url: "/api/config", headers: { host: "127.0.0.1:8787" } });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("openai/gpt-oss-120b");
    expect(r.body).not.toContain(KEY);
    expect(r.body).not.toContain("groq.com");
    await app.close();
  });
});

describe("full tool-calling cycle through the real runner (Groq adapter, fake provider)", () => {
  /** A scripted "model" speaking the OpenAI wire format. It derives its next step from the tool results it is shown. */
  function model(opts: { badArgsFirst?: boolean; forgedExecute?: boolean } = {}) {
    let bad = !!opts.badArgsFirst;
    let forged = !!opts.forgedExecute;
    return (body: Record<string, any>): Reply => {
      const tools = new Map<string, any>();
      for (const m of body.messages as any[]) if (m.role === "tool") { try { const v = JSON.parse(m.content); if (!v.error) tools.set(m.name, v); } catch { /* ignore */ } }
      if (!tools.has("get_quotes")) {
        return { json: chat({ content: "Reading the invoice, balances and offers.", tool_calls: [call("c1", "parse_invoice", {}), call("c2", "get_balances", {}), call("c3", "get_quotes", {})] }, "tool_calls") };
      }
      if (forged) { forged = false; return { json: chat({ content: null, tool_calls: [call("f1", "execute_sandbox_payment", { proposal_id: "prop_forged" })] }, "tool_calls") }; }
      if (!tools.has("evaluate_routes")) {
        if (bad) { bad = false; return { json: chat({ content: null, tool_calls: [call("e0", "evaluate_routes", "{preference: cheapest")] }, "tool_calls") }; }
        return { json: chat({ content: null, tool_calls: [call("e1", "evaluate_routes", { preference: "cheapest", reserve_usd_cents: "30000" })] }, "tool_calls") };
      }
      if (!tools.has("prepare_payment")) {
        const best = tools.get("evaluate_routes").bestQuoteId;
        return { json: chat({ content: null, tool_calls: [call("p1", "prepare_payment", { quote_id: best, preference: "cheapest", reserve_usd_cents: "30000" })] }, "tool_calls") };
      }
      return { json: chat({ content: "The proposal is ready for your review." }) };
    };
  }
  async function planWith(handler: (b: Record<string, any>, n: number) => Reply) {
    const f = await fake(handler);
    const ctx = makeCtx("standard", { APP_LLM_PROVIDER: "groq", APP_LLM_API_KEY: KEY, APP_LLM_MODEL: "openai/gpt-oss-120b", APP_LLM_BASE_URL: f.url });
    const llm = createLlm(ctx.config);
    expect(llm).toBeInstanceOf(OpenAiCompatibleLlm); // not MockLlm, even in the sandbox, when a provider is configured
    const runner = createRunner(ctx, llm, { retryDelayMs: 1 });
    const invoiceId = listInvoices(ctx, ALICE)[0].id;
    confirmInvoice(ctx, ALICE, invoiceId);
    const t = runner.startTask(ALICE, "execute", invoiceId, EN);
    await runner.settled(t.id);
    const task = getTask(ctx, ALICE, t.id);
    const events = ctx.db.prepare("SELECT tool, ok, output_json FROM agent_events WHERE task_id=? AND kind='tool' ORDER BY seq").all(t.id) as { tool: string; ok: number; output_json: string }[];
    return { f, ctx, task, events, count: (table: string) => (ctx.db.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as { c: number }).c };
  }

  it("runs definitions -> tool_calls -> validated execution -> results back to the model, then pauses for the human", async () => {
    const r = await planWith(model());
    expect(r.task.state).toBe("AWAITING_APPROVAL");
    expect(r.task.model).toBe("openai/gpt-oss-120b");
    expect(r.events.map((e) => e.tool)).toEqual(["parse_invoice", "get_balances", "get_quotes", "evaluate_routes", "prepare_payment"]);
    expect(r.events.every((e) => e.ok === 1)).toBe(true);
    expect(r.f.seen).toHaveLength(4);
    // every request carried the full pre-approval tool set and never the execution tool
    for (const s of r.f.seen) expect(s.body.tools.map((t: any) => t.function.name)).toEqual(["parse_invoice", "get_balances", "get_quotes", "evaluate_routes", "prepare_payment"]);
    // results were returned to the model against the matching call ids
    const last = r.f.seen[3].body.messages as any[];
    expect(last.filter((m) => m.role === "tool").map((m) => m.tool_call_id)).toEqual(["c1", "c2", "c3", "e1", "p1"]);
    expect(r.task.usage_known).toBe(1);
    expect(r.task.input_tokens).toBe(44);
    expect(r.task.output_tokens).toBe(28);
    expect(r.count("approvals")).toBe(0);
    expect(r.count("payments")).toBe(0); // the model never grants approval or pays
    expect(JSON.stringify(r.f.seen)).not.toContain("prop_forged");
  });
  it("returns unparseable arguments to the model as a structured tool error, and the model recovers", async () => {
    const r = await planWith(model({ badArgsFirst: true }));
    const bad = r.events.find((e) => e.tool === "evaluate_routes" && e.ok === 0)!;
    expect(bad).toBeTruthy();
    expect(JSON.parse(bad.output_json).error.code).toBeTruthy();
    expect(r.task.state).toBe("AWAITING_APPROVAL");
    const toolMsgs = (r.f.seen[2].body.messages as any[]).filter((m) => m.role === "tool" && m.tool_call_id === "e0");
    expect(JSON.parse(toolMsgs[0].content).error).toBeTruthy();
    // the malformed text itself is never echoed back as the call's arguments
    expect(JSON.stringify(r.f.seen[2].body.messages)).not.toContain("{preference: cheapest");
  });
  it("rejects a forged execution tool call before approval and creates no payment", async () => {
    const r = await planWith(model({ forgedExecute: true }));
    const forged = r.events.find((e) => e.tool === "execute_sandbox_payment")!;
    expect(forged.ok).toBe(0);
    expect(JSON.parse(forged.output_json).error.code).toBe("TOOL_NOT_AVAILABLE");
    expect(r.count("payments")).toBe(0);
    expect(r.count("approvals")).toBe(0);
    expect(r.task.state).toBe("AWAITING_APPROVAL");
  });
  it("retries a 429 within the bounded budget, honouring the pause the provider asked for", async () => {
    const m = model();
    const t0 = Date.now();
    const r = await planWith((b, n) => (n === 1 ? { status: 429, headers: { "retry-after": "1" }, json: { error: { message: "slow down" } } } : m(b)));
    expect(r.task.state).toBe("AWAITING_APPROVAL");
    expect(r.task.retries).toBe(1);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
    expect(r.f.seen).toHaveLength(5);
  });
  it("stops after the retry budget and fails visibly; no other provider, paid API or MockLlm is tried", async () => {
    const r = await planWith(() => ({ status: 429, headers: { "retry-after": "0" }, json: { error: { message: "limit" } } }));
    expect(r.task.state).toBe("FAILED");
    expect(r.task.retries).toBe(r.ctx.config.maxTransientRetries);
    expect(r.f.seen).toHaveLength(1 + r.ctx.config.maxTransientRetries);
    expect(r.task.error).toMatch(/rate limit/);
    expect(r.task.error).not.toContain(KEY);
    expect(r.events).toHaveLength(0);
    expect(r.count("approvals") + r.count("payments")).toBe(0);
  });
  it("fails on an invalid credential with a single request and no fallback", async () => {
    const r = await planWith(() => ({ status: 401, json: { error: { message: `bad key ${KEY}`, type: "invalid_request_error" } } }));
    expect(r.task.state).toBe("FAILED");
    expect(r.f.seen).toHaveLength(1);
    expect(r.task.retries).toBe(0);
    expect(r.task.error).not.toContain(KEY);
    expect(r.events).toHaveLength(0);
  });
  it("keeps the existing loop limits: a model that never stops calling tools hits the request cap", async () => {
    const r = await planWith(() => ({ json: chat({ content: null, tool_calls: [call(`x${Math.random()}`, "get_balances", {})] }, "tool_calls") }));
    expect(r.task.state).toBe("FAILED");
    expect(r.task.error).toMatch(/limit/i);
    expect(r.f.seen.length).toBeLessThanOrEqual(r.ctx.config.maxModelRequests);
  });
});
