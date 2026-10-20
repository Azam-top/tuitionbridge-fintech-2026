// A LOCAL FAKE model provider for browser tests of the live mode. It speaks the Messages API just enough to drive the app's
// real adapter through the real tools. It is test infrastructure, not a model: nothing here is evidence about a real model.
import { createServer } from "node:http";

interface Block { type: string; id?: string; name?: string; input?: unknown; text?: string; tool_use_id?: string; content?: unknown }
interface Msg { role: string; content: string | Block[] }

const server = createServer((req, res) => {
  if (req.url === "/health") { res.writeHead(200).end("ok"); return; }
  let raw = "";
  req.on("data", (d) => (raw += d));
  req.on("end", () => {
    const body = JSON.parse(raw || "{}") as { messages: Msg[] };
    const names = new Map<string, string>();
    const results = new Map<string, Record<string, unknown>>();
    let first = "";
    for (const m of body.messages) {
      if (typeof m.content === "string") { if (!first) first = m.content; continue; }
      for (const b of m.content) {
        if (b.type === "text" && m.role === "user" && !first) first = b.text ?? "";
        if (b.type === "tool_use" && b.id && b.name) names.set(b.id, b.name);
        if (b.type === "tool_result" && b.tool_use_id) {
          const text = typeof b.content === "string" ? b.content : (b.content as Block[] | undefined)?.map((c) => c.text ?? "").join("") ?? "{}";
          try { results.set(names.get(b.tool_use_id) ?? "?", JSON.parse(text) as Record<string, unknown>); } catch { /* ignore */ }
        }
      }
    }
    // Test switch: an instruction containing FAKE_PROVIDER_OUTAGE makes this fake answer HTTP 500, to exercise the app's failure states.
    if (/FAKE_PROVIDER_OUTAGE/.test(first)) { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "simulated outage" } })); return; }
    const preference = /fast/i.test(first) ? "fastest" : "cheapest";
    const reserve = /reserve_hint=(\d+)/.exec(first)?.[1] ?? "30000";
    let n = 0;
    const tool = (name: string, input: unknown): Block => ({ type: "tool_use", id: `toolu_fake_${Date.now()}_${n++}`, name, input });
    let content: Block[];
    let stop = "tool_use";
    if (!results.has("get_quotes")) content = [{ type: "text", text: "Reading the invoice, your declared funds and the current offers." }, tool("parse_invoice", {}), tool("get_balances", {}), tool("get_quotes", {})];
    else if (!results.has("evaluate_routes")) content = [{ type: "text", text: "Ranking the routes." }, tool("evaluate_routes", { preference, reserve_usd_cents: reserve })];
    else if (!results.has("prepare_payment") && results.get("evaluate_routes")!.bestQuoteId) content = [{ type: "text", text: "Preparing the proposal." }, tool("prepare_payment", { quote_id: results.get("evaluate_routes")!.bestQuoteId, preference, reserve_usd_cents: reserve })];
    else { content = [{ type: "text", text: "The proposal is ready for your review." }]; stop = "end_turn"; }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: `msg_fake_${Date.now()}`, type: "message", role: "assistant", model: "fake-model", content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 20 } }));
  });
});
server.listen(8797, "127.0.0.1", () => console.log("fake provider on 8797"));
