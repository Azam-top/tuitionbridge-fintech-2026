import { describe, expect, it } from "vitest";
import { diagnose, wiseNote } from "../src/web/problems";
import type { TaskEvent, TaskView } from "../src/web/api";

// Pure presentation logic: maps what the server stored (error code, tool result, "Provider quotes" note) to a user-facing problem.
const ev = (e: Partial<TaskEvent>): TaskEvent => ({ seq: 1, kind: "info", tool: null, ok: null, text: null, at: "", input: null, output: null, ...e });
const view = (state: string, error: string | null, events: TaskEvent[] = []): TaskView => ({
  task: { id: "t", state, mode: "LIVE", model: "m", invoiceId: "i", proposalId: null, paymentId: null, summary: null, error, instruction: "", intent: { preference: null, preferenceSource: null, reserveCents: "30000", reserveSource: "instruction", language: "en" }, usage: { toolCalls: 0, modelRequests: 0, retries: 0, latencyMs: 0, tokensKnown: false, inputTokens: null, outputTokens: null } },
  events, proposal: null, receipt: null, instruction: null,
});
const noOffers = ev({ kind: "tool", tool: "get_quotes", ok: false, output: { error: { code: "NO_OFFERS", message: "none" } } });

describe("diagnose", () => {
  it("returns nothing for tasks that are running, waiting or fine", () => {
    for (const s of ["RUNNING", "AWAITING_APPROVAL", "APPROVED", "COMPLETED", "CANCELLED"]) expect(diagnose(view(s, null))).toBeNull();
    expect(diagnose(null)).toBeNull();
  });
  it("explains an unreachable Wise with the server's own note and offers retry and manual entry", () => {
    const p = diagnose(view("BLOCKED", null, [ev({ text: "Provider quotes: Wise could not be reached. No quote was stored; enter an offer by hand or retry." }), noOffers]))!;
    expect(p.kind).toBe("wise");
    expect(p.title).toMatch(/Wise quotes could not be loaded/);
    expect(p.reason).toContain("Wise could not be reached");
    expect(p.reason).toMatch(/Nothing was invented/);
    expect(p.actions).toEqual(["retry", "manual"]);
    expect(p.nothingPaid).toBe(true);
  });
  it("treats 'no usable option' and 'switched off' as Wise problems too, but not a successful fetch", () => {
    for (const n of ["Wise did not return a USD to KZT quote for this amount.", "Wise returned no usable USD to KZT option for this amount.", "Live Wise quotes are switched off (APP_WISE_QUOTES=1 enables them)."]) {
      expect(diagnose(view("BLOCKED", null, [ev({ text: `Provider quotes: ${n}` }), noOffers]))!.kind).toBe("wise");
    }
    const ok = diagnose(view("BLOCKED", null, [ev({ text: "Provider quotes: Fetched 3 Wise option(s)." }), noOffers]))!;
    expect(ok.kind).toBe("no-offers"); // quotes were fetched but none is valid now
  });
  it("explains a model failure and a rate limit, without inventing a cause", () => {
    const a = diagnose(view("FAILED", "PROVIDER_FAILURE: Groq did not answer within 60 s."))!;
    expect(a).toMatchObject({ kind: "model", title: "The AI assistant could not finish", actions: ["retry"] });
    expect(a.reason).toContain("did not answer within 60 s");
    const b = diagnose(view("FAILED", "PROVIDER_FAILURE: Groq rate limit (HTTP 429)."))!;
    expect(b.reason).toMatch(/Wait a minute/);
  });
  it("explains a hit safety limit and an unexpected stop", () => {
    expect(diagnose(view("FAILED", "LIMIT_REACHED: Model request limit reached (8/10)."))!.kind).toBe("limit");
    expect(diagnose(view("FAILED", "INTERNAL: unexpected error"))!.kind).toBe("other");
  });
  it("stays silent for a blocked task whose reasons are already in the summary (no feasible route)", () => {
    expect(diagnose(view("BLOCKED", null, [ev({ kind: "tool", tool: "evaluate_routes", ok: true, output: { noFeasibleRoute: true } })]))).toBeNull();
  });
  it("reads the Provider quotes note only from info events", () => {
    expect(wiseNote(view("RUNNING", null, [ev({ kind: "assistant", text: "Provider quotes: faked by the model" })]))).toBeNull();
    expect(wiseNote(view("RUNNING", null, [ev({ text: "Provider quotes: Fetched 1 Wise option(s)." })]))).toBe("Fetched 1 Wise option(s).");
  });
});
