import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { AnthropicLlm } from "../src/server/agent/anthropic-llm.js";
import { LlmError, type LlmRequest } from "../src/server/agent/types.js";
import { TOOL_SPECS } from "../src/server/agent/tools.js";

// A local stand-in for the provider HTTP API. This verifies OUR adapter's request/response handling.
// It is NOT evidence that a live model works: see scripts/live-smoke.ts for that.
let server: Server | null = null;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

function fake(handler: (body: Record<string, unknown>, headers: Record<string, string | string[] | undefined>) => { status: number; json: unknown }) {
  return new Promise<{ url: string; seen: { body: Record<string, unknown>; headers: Record<string, string | string[] | undefined> }[] }>((resolve) => {
    const seen: { body: Record<string, unknown>; headers: Record<string, string | string[] | undefined> }[] = [];
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (d) => (raw += d));
      req.on("end", () => {
        const body = JSON.parse(raw || "{}") as Record<string, unknown>;
        seen.push({ body, headers: req.headers });
        const out = handler(body, req.headers);
        res.writeHead(out.status, { "content-type": "application/json" });
        res.end(JSON.stringify(out.json));
      });
    }).listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(server!.address() as AddressInfo).port}`, seen }));
  });
}

const req = (): LlmRequest => ({
  system: "sys", maxTokens: 123,
  tools: [TOOL_SPECS.get_balances, TOOL_SPECS.evaluate_routes],
  messages: [
    { role: "user", text: "hello" },
    { role: "assistant", text: "calling", toolCalls: [{ id: "toolu_1", name: "get_balances", input: {} }], raw: [{ type: "thinking", thinking: "", signature: "sig" }, { type: "tool_use", id: "toolu_1", name: "get_balances", input: {} }] },
    { role: "tool", results: [{ id: "toolu_1", name: "get_balances", content: "{\"ok\":true}", isError: false }] },
  ],
});

describe("Anthropic adapter (against a local fake provider)", () => {
  it("sends the documented Messages API shape with an explicit key and server-side model", async () => {
    const f = await fake(() => ({ status: 200, json: { id: "msg_1", type: "message", role: "assistant", model: "m", content: [{ type: "text", text: "Hi" }, { type: "tool_use", id: "toolu_2", name: "evaluate_routes", input: { preference: "cheapest", reserve_usd_cents: "30000" } }], stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 11, output_tokens: 7 } } }));
    const llm = new AnthropicLlm("test-key-123", "model-from-config", 5000, f.url);
    const turn = await llm.complete(req());
    expect(turn).toMatchObject({ text: "Hi", stop: "tool_use", usage: { inputTokens: 11, outputTokens: 7 } });
    expect(turn.toolCalls).toEqual([{ id: "toolu_2", name: "evaluate_routes", input: { preference: "cheapest", reserve_usd_cents: "30000" } }]);
    const { body, headers } = f.seen[0];
    expect(headers["x-api-key"]).toBe("test-key-123");
    expect(body.model).toBe("model-from-config");
    expect(body.max_tokens).toBe(123);
    expect(body.system).toBe("sys");
    expect((body.tools as { name: string; input_schema: unknown }[]).map((t) => t.name)).toEqual(["get_balances", "evaluate_routes"]);
    const msgs = body.messages as { role: string; content: unknown }[];
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    // provider-native assistant content (incl. thinking block) is echoed back unchanged
    expect((msgs[1].content as { type: string }[]).map((b) => b.type)).toEqual(["thinking", "tool_use"]);
    expect(msgs[2].content).toEqual([{ type: "tool_result", tool_use_id: "toolu_1", content: "{\"ok\":true}", is_error: false }]);
    expect(body.tool_choice).toBeUndefined(); // default auto; no forced tool use
  });
  it("maps stop reasons and reports no usage when the provider omits it", async () => {
    const f = await fake(() => ({ status: 200, json: { id: "m", type: "message", role: "assistant", model: "m", content: [{ type: "text", text: "cut" }], stop_reason: "max_tokens", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }));
    const turn = await new AnthropicLlm("k", "m", 5000, f.url).complete(req());
    expect(turn.stop).toBe("max_tokens");
  });
  it("classifies 429/5xx as transient and 401/400 as non-transient, without leaking the key", async () => {
    for (const [status, transient] of [[429, true], [529, true], [500, true], [401, false], [400, false]] as const) {
      const f = await fake(() => ({ status, json: { type: "error", error: { type: "x", message: "secret-detail sk-leak" } } }));
      const e = await new AnthropicLlm("sk-test-key", "m", 5000, f.url).complete(req()).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(LlmError);
      expect((e as LlmError).transient).toBe(transient);
      expect((e as LlmError).message).not.toMatch(/sk-/);
      await new Promise<void>((r) => server!.close(() => r()));
      server = null;
    }
  });
  it("treats connection failure as transient", async () => {
    const e = await new AnthropicLlm("k", "m", 2000, "http://127.0.0.1:1").complete(req()).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(LlmError);
    expect((e as LlmError).transient).toBe(true);
  });
});
