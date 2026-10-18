// Server-side proposal guards (audit F1: route objective, quote freshness; F2: write-time task-state guard).
import { describe, expect, it } from "vitest";
import { createRunner } from "../src/server/agent/runner.js";
import { MockLlm } from "../src/server/agent/mock-llm.js";
import type { LlmTurn } from "../src/server/agent/types.js";
import { proposalView } from "../src/server/services/proposals.js";
import { PolicyError } from "../src/server/errors.js";
import { ALICE, count } from "./helpers.js";
import type { Ctx } from "../src/server/ctx.js";
import { EN, Scripted, directPrepare, run, setup, toolEvents } from "./agent-helpers.js";

describe("F1: the server enforces the route objective", () => {
  it("rejects a feasible but costlier quote when the instruction asks for the cheapest route", async () => {
    const ref: { ctx?: Ctx } = {};
    const s = setup(directPrepare("A", "cheapest", ref));
    ref.ctx = s.ctx;
    const t = await run(s);
    expect(t.state).toBe("BLOCKED");
    expect(t.proposal_id).toBeNull();
    expect(count(s.ctx, "proposals")).toBe(0);
    expect(count(s.ctx, "payments")).toBe(0);
    const last = toolEvents(s.ctx, t.id).at(-1)!;
    expect(last.ok).toBe(0);
    expect(JSON.parse(last.output_json).error.code).toBe("ROUTE_NOT_OPTIMAL");
  });
  it("accepts the best cheapest route and binds the ranking evidence into the proposal", async () => {
    const ref: { ctx?: Ctx } = {};
    const s = setup(directPrepare("C", "cheapest", ref));
    ref.ctx = s.ctx;
    const t = await run(s);
    expect(t.state).toBe("AWAITING_APPROVAL");
    const p = proposalView(s.ctx, ALICE, t.proposal_id!);
    expect(p.payload.providerId).toBe("C");
    expect(p.payload.selection).toMatchObject({ basis: "server_ranking_v1", objective: "cheapest" });
    expect(p.payload.selection.rankedFeasibleQuoteIds[0]).toBe(p.payload.quoteId);
    expect(p.payload.selection.candidateQuoteIds).toHaveLength(3);
  });
  it("the fastest instruction selects A and rejects the cheaper C", async () => {
    const ref: { ctx?: Ctx } = {};
    const ok = setup(directPrepare("A", "fastest", ref));
    ref.ctx = ok.ctx;
    const t = await run(ok, "Pay the invoice, prefer faster arrival, keep USD 300");
    expect(t.state).toBe("AWAITING_APPROVAL");
    expect(proposalView(ok.ctx, ALICE, t.proposal_id!).payload.providerId).toBe("A");

    const ref2: { ctx?: Ctx } = {};
    const bad = setup(directPrepare("C", "fastest", ref2));
    ref2.ctx = bad.ctx;
    const t2 = await run(bad, "Pay the invoice, prefer faster arrival, keep USD 300");
    expect(t2.state).toBe("BLOCKED");
    expect(count(bad.ctx, "proposals")).toBe(0);
  });
  it("a superseded quote version cannot be used even if it is still unexpired", async () => {
    const s = setup(new MockLlm());
    const { issueQuotes } = await import("../src/server/services/quotes.js");
    const { prepareProposal } = await import("../src/server/services/proposals.js");
    const old = issueQuotes(s.ctx, ALICE, s.invoiceId).find((q) => q.providerId === "C")!;
    issueQuotes(s.ctx, ALICE, s.invoiceId);
    let code = "NO_ERROR";
    try { prepareProposal(s.ctx, { ownerId: ALICE, tier: "propose", invoiceId: s.invoiceId, quoteId: old.id, preference: "cheapest", reserveCents: "30000" }); }
    catch (e) { if (e instanceof PolicyError) code = e.code; }
    expect(code).toBe("QUOTE_SUPERSEDED");
    expect(count(s.ctx, "proposals")).toBe(0);
  });
});

describe("F2 (write time): the database refuses a proposal for a task that is not running", () => {
  it("prepareProposal with a cancelled task id creates nothing", async () => {
    const s = setup(new MockLlm());
    const { issueQuotes } = await import("../src/server/services/quotes.js");
    const { prepareProposal } = await import("../src/server/services/proposals.js");
    const gate = new Scripted(() => new Promise<LlmTurn>(() => {})); // never answers
    const runner = createRunner(s.ctx, gate, { retryDelayMs: 1 });
    const t = runner.startTask(ALICE, "execute", s.invoiceId, EN);
    runner.cancel(ALICE, t.id);
    const q = issueQuotes(s.ctx, ALICE, s.invoiceId).find((x) => x.providerId === "C")!;
    let code = "NO_ERROR";
    try { prepareProposal(s.ctx, { ownerId: ALICE, tier: "propose", invoiceId: s.invoiceId, quoteId: q.id, preference: "cheapest", reserveCents: "30000", taskId: t.id }); }
    catch (e) { if (e instanceof PolicyError) code = e.code; }
    expect(code).toBe("TASK_STATE");
    expect(count(s.ctx, "proposals")).toBe(0);
  });
});

