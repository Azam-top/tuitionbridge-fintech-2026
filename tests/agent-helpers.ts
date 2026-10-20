// Shared scripted-driver helpers for the agent hardening tests (no real model is ever called).
import { createRunner, getTask, type TaskRow } from "../src/server/agent/runner.js";
import type { LlmClient, LlmRequest, LlmTurn, ToolCall } from "../src/server/agent/types.js";
import { confirmInvoice, listInvoices } from "../src/server/services/invoices.js";
import { ALICE, makeCtx } from "./helpers.js";
import type { Ctx } from "../src/server/ctx.js";

export const EN = "Pay this invoice by its deadline, use the cheapest feasible route, and keep USD 300 for living costs.";

export function setup(llm: LlmClient, scenario: Parameters<typeof makeCtx>[0] = "standard") {
  const ctx = makeCtx(scenario);
  const runner = createRunner(ctx, llm, { retryDelayMs: 1 });
  const invoiceId = listInvoices(ctx, ALICE)[0].id;
  confirmInvoice(ctx, ALICE, invoiceId);
  return { ctx, runner, invoiceId };
}

export class Scripted implements LlmClient {
  readonly mode = "LIVE" as const;
  readonly model = "scripted-test-model";
  calls = 0;
  constructor(private fn: (req: LlmRequest, n: number) => LlmTurn | Promise<LlmTurn>) {}
  async complete(req: LlmRequest): Promise<LlmTurn> { return this.fn(req, ++this.calls); }
}
export const turn = (text: string, calls: Omit<ToolCall, "id">[] = []): LlmTurn => ({
  text, toolCalls: calls.map((c, i) => ({ ...c, id: `t${Math.random().toString(36).slice(2)}${i}` })),
  usage: { inputTokens: 10, outputTokens: 5 }, stop: calls.length ? "tool_use" : "end",
});
export const quoteOf = (ctx: Ctx, provider: string): string =>
  (ctx.db.prepare("SELECT id FROM quotes WHERE provider_id=? ORDER BY version DESC").get(provider) as { id: string }).id;
export const toolEvents = (ctx: Ctx, taskId: string) =>
  ctx.db.prepare("SELECT tool, ok, output_json FROM agent_events WHERE task_id=? AND kind='tool' ORDER BY seq").all(taskId) as { tool: string; ok: number; output_json: string }[];
export const assistantEvents = (ctx: Ctx, taskId: string) =>
  (ctx.db.prepare("SELECT text FROM agent_events WHERE task_id=? AND kind='assistant' ORDER BY seq").all(taskId) as { text: string }[]).map((e) => e.text);
export const run = async (s: ReturnType<typeof setup>, instruction = EN): Promise<TaskRow> => {
  const t = s.runner.startTask(ALICE, "execute", s.invoiceId, instruction);
  await s.runner.settled(t.id);
  return getTask(s.ctx, ALICE, t.id);
};

/** Drives get_quotes then prepare_payment for a chosen provider, skipping evaluate_routes entirely. */
export function directPrepare(provider: "A" | "B" | "C", preference: "cheapest" | "fastest", ctxRef: { ctx?: Ctx }) {
  return new Scripted((_req, n) => {
    if (n === 1) return turn("Fetching quotes.", [{ name: "get_quotes", input: {} }]);
    if (n === 2) return turn("Preparing.", [{ name: "prepare_payment", input: { quote_id: quoteOf(ctxRef.ctx!, provider), preference, reserve_usd_cents: "30000" } }]);
    return turn("Done.");
  });
}

