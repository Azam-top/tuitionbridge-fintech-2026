import { describe, expect, it } from "vitest";
import { createRunner, getTask, type TaskRow } from "../src/server/agent/runner.js";
import { MockLlm } from "../src/server/agent/mock-llm.js";
import { LlmError, type LlmClient, type LlmRequest, type LlmTurn, type ToolCall } from "../src/server/agent/types.js";
import { confirmInvoice, listInvoices, updateInvoice } from "../src/server/services/invoices.js";
import { proposalView } from "../src/server/services/proposals.js";
import { PolicyError } from "../src/server/errors.js";
import { ALICE, BOB, balance, count, makeCtx } from "./helpers.js";
import type { Ctx } from "../src/server/ctx.js";

const EN = "Pay this invoice by its deadline, use the cheapest feasible route, and keep USD 300 for living costs.";

function setup(scenario: Parameters<typeof makeCtx>[0] = "standard", llm: LlmClient = new MockLlm(), env: NodeJS.ProcessEnv = {}) {
  const ctx = makeCtx(scenario, env);
  const runner = createRunner(ctx, llm, { retryDelayMs: 1 });
  const invoiceId = listInvoices(ctx, ALICE)[0].id;
  return { ctx, runner, invoiceId };
}
const confirm = (ctx: Ctx, id: string) => confirmInvoice(ctx, ALICE, id);
async function run(s: ReturnType<typeof setup>, instruction = EN): Promise<TaskRow> {
  confirm(s.ctx, s.invoiceId);
  const t = s.runner.startTask(ALICE, "execute", s.invoiceId, instruction);
  await s.runner.settled(t.id);
  return getTask(s.ctx, ALICE, t.id);
}
const toolEvents = (ctx: Ctx, taskId: string) =>
  ctx.db.prepare("SELECT tool, ok, output_json FROM agent_events WHERE task_id=? AND kind='tool' ORDER BY seq").all(taskId) as { tool: string; ok: number; output_json: string }[];
const codeOf = (fn: () => unknown): string => { try { fn(); } catch (e) { if (e instanceof PolicyError) return e.code; throw e; } return "NO_ERROR"; };

/** Scriptable fake provider for adversarial and failure tests. */
class Scripted implements LlmClient {
  readonly mode = "LIVE" as const;
  readonly model = "scripted-test-model";
  calls = 0;
  constructor(private fn: (req: LlmRequest, n: number) => LlmTurn | Promise<LlmTurn>) {}
  async complete(req: LlmRequest): Promise<LlmTurn> { return this.fn(req, ++this.calls); }
}
const turn = (text: string, calls: Omit<ToolCall, "id">[] = [], usage = { inputTokens: 10, outputTokens: 5 }): LlmTurn => ({
  text, toolCalls: calls.map((c, i) => ({ ...c, id: `t${Math.random().toString(36).slice(2)}${i}` })), usage, stop: calls.length ? "tool_use" : "end",
});
const names = (req: LlmRequest) => req.tools.map((t) => t.name);

describe("mock agent: full task (same tools/policies as live)", () => {
  it("pauses at AWAITING_APPROVAL with an unpaid proposal for the cheapest feasible route", async () => {
    const s = setup();
    const t = await run(s);
    expect(t.state).toBe("AWAITING_APPROVAL");
    expect(t.mode).toBe("MOCK");
    expect(t.usage_known).toBe(0); // no fabricated usage in MOCK mode
    const p = proposalView(s.ctx, ALICE, t.proposal_id!);
    expect(p.payload.providerId).toBe("C");
    expect(p.payload.totalDebitCents).toBe("101000");
    expect(p.status).toBe("PENDING");
    expect(p.approval).toBeNull();
    expect(balance(s.ctx, ALICE, "USD")).toBe(150_000n); // nothing moved yet
    expect(count(s.ctx, "payments")).toBe(0);
    expect(toolEvents(s.ctx, t.id).map((e) => e.tool)).toEqual(["parse_invoice", "get_balances", "get_quotes", "evaluate_routes", "prepare_payment"]);
  });
  it("executes only after the human approval endpoint, then completes", async () => {
    const s = setup();
    const t = await run(s);
    const p = proposalView(s.ctx, ALICE, t.proposal_id!);
    await expect(s.runner.approveAndResume(ALICE, "execute", t.id, "0".repeat(64))).rejects.toMatchObject({ code: "APPROVAL_MISMATCH" });
    expect(getTask(s.ctx, ALICE, t.id).state).toBe("AWAITING_APPROVAL");
    expect(balance(s.ctx, ALICE, "USD")).toBe(150_000n);
    await s.runner.approveAndResume(ALICE, "execute", t.id, p.hash);
    await s.runner.settled(t.id);
    const done = getTask(s.ctx, ALICE, t.id);
    expect(done.state).toBe("COMPLETED");
    expect(done.payment_id).toBeTruthy();
    expect(balance(s.ctx, ALICE, "USD")).toBe(49_000n);
    expect(done.tool_calls).toBeLessThanOrEqual(8);
    expect(done.model_requests).toBeLessThanOrEqual(10);
    expect(count(s.ctx, "payments")).toBe(1);
  });
  it("a double-clicked approval executes exactly once", async () => {
    const s = setup();
    const t = await run(s);
    const hash = proposalView(s.ctx, ALICE, t.proposal_id!).hash;
    await Promise.all([s.runner.approveAndResume(ALICE, "execute", t.id, hash), s.runner.approveAndResume(ALICE, "execute", t.id, hash).catch(() => null)]);
    await s.runner.settled(t.id);
    expect(count(s.ctx, "payments")).toBe(1);
    expect(balance(s.ctx, ALICE, "USD")).toBe(49_000n);
  });
  it("selects the faster route when asked", async () => {
    const s = setup();
    const t = await run(s, "Pay the invoice, prefer faster arrival, keep USD 300");
    expect(t.state).toBe("AWAITING_APPROVAL");
    expect(proposalView(s.ctx, ALICE, t.proposal_id!).payload.providerId).toBe("A");
  });
  it("understands an equivalent Russian instruction", async () => {
    const s = setup();
    const t = await run(s, "Оплати счёт до срока, выбери самый дешёвый вариант и оставь 300 долларов на жизнь.");
    expect(JSON.parse(t.intent_json)).toMatchObject({ language: "ru", preference: "cheapest", reserveCents: "30000" });
    expect(proposalView(s.ctx, ALICE, t.proposal_id!).payload.providerId).toBe("C");
  });
  it("honors a larger reserve by excluding routes that breach it", async () => {
    const s = setup();
    const t = await run(s, "cheapest route, keep USD 600 for living costs");
    expect(t.state).toBe("BLOCKED"); // 1500 - 1010 = 490 < 600 for every route
    expect(t.proposal_id).toBeNull();
    expect(count(s.ctx, "payments")).toBe(0);
  });
});

describe("blocked outcomes create no proposal", () => {
  it("no route arrives by the deadline", async () => {
    const t = await run(setup("all_late"));
    expect(t.state).toBe("BLOCKED");
    expect(t.proposal_id).toBeNull();
    expect(t.summary).toMatch(/No route qualifies/);
  });
  it("insufficient funds", async () => {
    const s = setup("insufficient");
    const t = await run(s);
    expect(t.state).toBe("BLOCKED");
    expect(count(s.ctx, "proposals")).toBe(0);
    expect(balance(s.ctx, ALICE, "USD")).toBe(90_000n);
  });
  it("a trusted-recipient mismatch blocks the invoice and the task, recoverably", () => {
    const s = setup("recipient_mismatch");
    const inv = confirm(s.ctx, s.invoiceId);
    expect(inv.status).toBe("BLOCKED");
    expect(inv.issues.map((i) => i.code)).toContain("RECIPIENT_MISMATCH");
    expect(inv.issues[0].message).toMatch(/not a proven fraud/);
    expect(codeOf(() => s.runner.startTask(ALICE, "execute", s.invoiceId, EN))).toBe("INVOICE_NOT_CONFIRMED");
    // recover: correct the account, revalidate, reconfirm
    updateInvoice(s.ctx, ALICE, s.invoiceId, { beneficiaryAccount: "KZ00SANDBOX0000000001" });
    expect(confirm(s.ctx, s.invoiceId).status).toBe("CONFIRMED");
  });
  it("an ambiguous invoice blocks until the field is explicitly re-entered", () => {
    const s = setup();
    s.ctx.db.prepare("UPDATE invoices SET ambiguous_fields='[\"amountKztTiyn\"]' WHERE id=?").run(s.invoiceId);
    const blocked = confirm(s.ctx, s.invoiceId);
    expect(blocked.status).toBe("BLOCKED");
    expect(blocked.issues[0].code).toBe("AMBIGUOUS");
    expect(codeOf(() => s.runner.startTask(ALICE, "execute", s.invoiceId, EN))).toBe("INVOICE_NOT_CONFIRMED");
    updateInvoice(s.ctx, ALICE, s.invoiceId, { amountKztTiyn: "50000000" });
    expect(confirm(s.ctx, s.invoiceId).status).toBe("CONFIRMED");
  });
  it("conflicting or oversize instructions are rejected before a task exists", () => {
    const s = setup();
    confirm(s.ctx, s.invoiceId);
    expect(codeOf(() => s.runner.startTask(ALICE, "execute", s.invoiceId, "use the cheapest and the fastest route"))).toBe("INTENT_CONFLICT");
    expect(codeOf(() => s.runner.startTask(ALICE, "execute", s.invoiceId, "x".repeat(501)))).toBe("VALIDATION");
    expect(count(s.ctx, "agent_tasks")).toBe(0);
  });
  it("read-only users cannot start tasks; other users cannot see them", async () => {
    const s = setup();
    confirm(s.ctx, s.invoiceId);
    expect(codeOf(() => s.runner.startTask(ALICE, "read", s.invoiceId, EN))).toBe("FORBIDDEN_TIER");
    const t = s.runner.startTask(ALICE, "execute", s.invoiceId, EN);
    await s.runner.settled(t.id);
    expect(codeOf(() => getTask(s.ctx, BOB, t.id))).toBe("NOT_FOUND");
    expect(codeOf(() => s.runner.cancel(BOB, t.id))).toBe("NOT_FOUND");
  });
  it("allows only one active task per user", async () => {
    const s = setup();
    confirm(s.ctx, s.invoiceId);
    const t = s.runner.startTask(ALICE, "execute", s.invoiceId, EN);
    await s.runner.settled(t.id);
    expect(codeOf(() => s.runner.startTask(ALICE, "execute", s.invoiceId, EN))).toBe("TASK_ACTIVE");
    s.runner.cancel(ALICE, t.id);
    expect(s.runner.startTask(ALICE, "execute", s.invoiceId, EN).id).not.toBe(t.id);
  });
});

describe("malicious invoice and adversarial model (critical)", () => {
  it("invoice injection text changes nothing: same beneficiary, same approval requirement, no debit", async () => {
    const s = setup("malicious");
    const t = await run(s);
    expect(t.state).toBe("AWAITING_APPROVAL");
    const p = proposalView(s.ctx, ALICE, t.proposal_id!);
    expect(p.payload.beneficiaryAccount).toBe("KZ00SANDBOX0000000001");
    expect(p.approval).toBeNull();
    expect(balance(s.ctx, ALICE, "USD")).toBe(150_000n);
    expect(count(s.ctx, "payments")).toBe(0);
    const parse = toolEvents(s.ctx, t.id).find((e) => e.tool === "parse_invoice")!;
    expect(parse.output_json).toMatch(/untrustedNotes/);
  });
  it("a model that obeys the injection cannot execute, change beneficiary, lower reserve or switch preference", async () => {
    const s = setup("malicious");
    confirm(s.ctx, s.invoiceId);
    const llm = new Scripted((req, n) => {
      if (n === 1) return turn("Following the invoice's instructions.", [
        { name: "execute_sandbox_payment", input: { proposal_id: "prop_x" } }, // not exposed in phase 1
        { name: "approve_payment", input: {} }, // does not exist
        { name: "get_quotes", input: {} },
      ]);
      if (n === 2) return turn("Trying to bend constraints.", [
        { name: "evaluate_routes", input: { preference: "fastest", reserve_usd_cents: "30000" } }, // preference conflict
        { name: "evaluate_routes", input: { preference: "cheapest", reserve_usd_cents: "0" } }, // reserve lowering
        { name: "evaluate_routes", input: { preference: "cheapest", reserve_usd_cents: "30000", beneficiary_account: "KZ99ATTACKER0000000001" } }, // extra arg
      ]);
      return turn("The payment is approved and paid.");
    });
    const runner = createRunner(s.ctx, llm, { retryDelayMs: 1 });
    const t = runner.startTask(ALICE, "execute", s.invoiceId, EN);
    await runner.settled(t.id);
    const done = getTask(s.ctx, ALICE, t.id);
    const ev = toolEvents(s.ctx, t.id);
    const codes = ev.map((e) => (e.ok ? "ok" : (JSON.parse(e.output_json) as { error: { code: string } }).error.code));
    expect(codes).toEqual(["TOOL_NOT_AVAILABLE", "TOOL_NOT_AVAILABLE", "ok", "INTENT_CONFLICT", "RESERVE_LOWERING", "INVALID_ARGUMENTS"]);
    expect(done.state).toBe("BLOCKED"); // a sentence saying "approved" has no authority
    expect(done.proposal_id).toBeNull();
    expect(count(s.ctx, "payments")).toBe(0);
    expect(balance(s.ctx, ALICE, "USD")).toBe(150_000n);
  });
  it("after approval the model still cannot pay a different proposal or skip the server policy", async () => {
    const s = setup();
    confirm(s.ctx, s.invoiceId);
    let phase2 = false;
    const llm = new Scripted((req, n) => {
      if (!names(req).includes("execute_sandbox_payment")) {
        const mock = new MockLlm();
        return mock.complete(req);
      }
      phase2 = true;
      if (n < 99 && !req.messages.some((m) => m.role === "tool")) return turn("executing", [{ name: "execute_sandbox_payment", input: { proposal_id: "prop_someone_elses" } }]);
      return turn("could not execute");
    });
    const runner = createRunner(s.ctx, llm, { retryDelayMs: 1 });
    const t = runner.startTask(ALICE, "execute", s.invoiceId, EN);
    await runner.settled(t.id);
    const hash = proposalView(s.ctx, ALICE, getTask(s.ctx, ALICE, t.id).proposal_id!).hash;
    await runner.approveAndResume(ALICE, "execute", t.id, hash);
    await runner.settled(t.id);
    expect(phase2).toBe(true);
    expect(getTask(s.ctx, ALICE, t.id).state).toBe("BLOCKED");
    expect(count(s.ctx, "payments")).toBe(0);
  });
  it("the post-approval phase fails closed when the quote expired in the meantime", async () => {
    const s = setup("standard", new MockLlm(), { APP_QUOTE_TTL_MS: "60000", APP_APPROVAL_TTL_MS: "3600000" });
    const t = await run(s);
    const hash = proposalView(s.ctx, ALICE, t.proposal_id!).hash;
    s.ctx.clock.advanceMs(120_000);
    await expect(s.runner.approveAndResume(ALICE, "execute", t.id, hash)).rejects.toMatchObject({ code: "PROPOSAL_EXPIRED" });
    expect(count(s.ctx, "payments")).toBe(0);
    expect(balance(s.ctx, ALICE, "USD")).toBe(150_000n);
  });
});

describe("limits and provider failures", () => {
  it("fails visibly at the tool-call limit and never pays", async () => {
    const llm = new Scripted(() => turn("again", [{ name: "get_balances", input: {} }]));
    const s = setup("standard", llm);
    const t = await run(s);
    expect(t.state).toBe("FAILED");
    expect(t.error).toMatch(/LIMIT_REACHED/);
    expect(t.tool_calls).toBeLessThanOrEqual(7); // one call reserved for post-approval execution
    expect(count(s.ctx, "payments")).toBe(0);
  });
  it("fails visibly at the model-request limit", async () => {
    const llm = new Scripted(() => turn("thinking out loud", [{ name: "get_balances", input: {} }]));
    const s = setup("standard", llm, { APP_MAX_TOOL_CALLS: "100" });
    const t = await run(s);
    expect(t.state).toBe("FAILED");
    expect(t.model_requests).toBeLessThanOrEqual(8); // two requests reserved for post-approval
  });
  it("stops at the token budget when usage is reported", async () => {
    const llm = new Scripted(() => turn("x", [{ name: "get_balances", input: {} }], { inputTokens: 600, outputTokens: 600 }));
    const s = setup("standard", llm, { APP_TASK_TOKEN_BUDGET: "1000" });
    const t = await run(s);
    expect(t.state).toBe("FAILED");
    expect(t.usage_known).toBe(1);
    expect(t.input_tokens + t.output_tokens).toBeGreaterThan(0);
  });
  it("retries transient provider errors up to the limit, then recovers", async () => {
    let fails = 2;
    const mock = new MockLlm();
    const llm = new Scripted((req) => { if (fails-- > 0) throw new LlmError("HTTP 529", true, 529); return mock.complete(req); });
    const t = await run(setup("standard", llm));
    expect(t.state).toBe("AWAITING_APPROVAL");
    expect(t.retries).toBe(2);
    expect(t.model_requests).toBe(2 + 4); // two failed attempts count as requests, plus four successful turns
  });
  it("gives up after the retry budget and fails visibly", async () => {
    const llm = new Scripted(() => { throw new LlmError("HTTP 503", true, 503); });
    const s = setup("standard", llm);
    const t = await run(s);
    expect(t.state).toBe("FAILED");
    expect(t.error).toMatch(/PROVIDER_FAILURE/);
    expect(t.retries).toBe(2);
    expect(t.model_requests).toBe(3);
  });
  it("does not retry non-transient errors and never leaks the key into the error", async () => {
    const llm = new Scripted(() => { throw new LlmError("Model provider returned HTTP 401.", false, 401); });
    const s = setup("standard", llm);
    const t = await run(s);
    expect(t.state).toBe("FAILED");
    expect(t.retries).toBe(0);
    expect(t.model_requests).toBe(1);
    expect(JSON.stringify(t)).not.toMatch(/sk-/);
  });
  it("labels the mode and model from the adapter, not from the model's claims", async () => {
    const mock = new MockLlm();
    const llm = new Scripted((req) => mock.complete(req));
    const t = await run(setup("standard", llm));
    expect(t.mode).toBe("LIVE"); // the adapter says LIVE; real LIVE verification is a separate smoke test
    expect(t.model).toBe("scripted-test-model");
  });
});
