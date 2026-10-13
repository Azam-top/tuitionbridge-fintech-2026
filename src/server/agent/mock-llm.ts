import { parseInstruction } from "../../shared/intent.js";
import type { ChatMessage, LlmClient, LlmRequest, LlmTurn, ToolCall } from "./types.js";

/**
 * Deterministic stand-in for the model. It drives the SAME tools, policies and database as the live
 * adapter, but it is MOCK: it is never presented as a verified live model run, and it reports no token usage.
 */
export class MockLlm implements LlmClient {
  readonly mode = "MOCK" as const;
  readonly model = null;
  private n = 0;

  async complete(req: LlmRequest): Promise<LlmTurn> {
    const results = new Map<string, { ok: boolean; data: Record<string, unknown> }>();
    for (const m of req.messages) {
      if (m.role === "tool") for (const r of m.results) results.set(r.name, { ok: !r.isError, data: JSON.parse(r.content) as Record<string, unknown> });
    }
    const first = req.messages.find((m): m is Extract<ChatMessage, { role: "user" }> => m.role === "user");
    const instruction = first?.text ?? "";
    const parsed = parseInstruction(instruction);
    const call = (name: string, input: unknown): ToolCall => ({ id: `mock_${++this.n}`, name, input });
    const turn = (text: string, toolCalls: ToolCall[]): LlmTurn => ({ text, toolCalls, usage: null, stop: toolCalls.length ? "tool_use" : "end" });
    const names = new Set(req.tools.map((t) => t.name));

    if (names.has("execute_sandbox_payment")) {
      const proposalId = /proposal_id=(\S+)/.exec(instruction)?.[1] ?? "";
      const done = results.get("execute_sandbox_payment");
      if (!done) return turn("The human approved the proposal. Executing it in the simulated ledger.", [call("execute_sandbox_payment", { proposal_id: proposalId })]);
      if (!done.ok) return turn(`The payment was not executed: ${String((done.data.error as { message?: string })?.message ?? "rejected")}.`, []);
      return turn(`Done (SIMULATED). Debited ${String(done.data.debited)}; the university account was credited ${String(done.data.recipientCredited)}. USD balance after: ${String(done.data.usdBalanceAfter)}.`, []);
    }

    const reserve = /reserve_hint=(\d+)/.exec(instruction)?.[1] ?? parsed.reserveCents ?? "30000";
    const preference = parsed.preference ?? "cheapest";
    if (!results.has("get_quotes")) {
      return turn("I will read the confirmed invoice and balances, then request simulated quotes.", [call("parse_invoice", {}), call("get_balances", {}), call("get_quotes", {})]);
    }
    const inv = results.get("parse_invoice");
    if (inv && !inv.ok) return turn(`I cannot continue: ${String((inv.data.error as { message?: string })?.message)}`, []);
    if (!results.has("evaluate_routes")) {
      return turn(`Ranking the routes for the ${preference} preference while keeping the reserve.`, [call("evaluate_routes", { preference, reserve_usd_cents: reserve })]);
    }
    const ev = results.get("evaluate_routes")!;
    if (!ev.ok) return turn(`Route evaluation was rejected: ${String((ev.data.error as { message?: string })?.message)}`, []);
    if (ev.data.noFeasibleRoute) {
      const routes = ev.data.routes as { provider: string; exclusions: { message: string }[] }[];
      const why = routes.map((r) => `${r.provider}: ${r.exclusions.map((e) => e.message).join(" ")}`).join(" | ");
      return turn(`No route qualifies, so I did not prepare a payment. ${why}`, []);
    }
    if (!results.has("prepare_payment")) {
      return turn("Preparing an immutable proposal for the best qualifying route. No money moves yet.", [call("prepare_payment", { quote_id: String(ev.data.bestQuoteId), preference, reserve_usd_cents: reserve })]);
    }
    const prep = results.get("prepare_payment")!;
    if (!prep.ok) return turn(`The proposal could not be prepared: ${String((prep.data.error as { message?: string })?.message)}`, []);
    return turn(`Proposal ${String(prep.data.proposalId)} is ready: you will be debited ${String(prep.data.willBeDebited)} and the university will receive ${String(prep.data.recipientWillReceive)}. Nothing has been paid. Please review and approve it.`, []);
  }
}
