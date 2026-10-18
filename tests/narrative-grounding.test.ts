// Model prose never becomes a financial fact (audit F3).
import { describe, expect, it } from "vitest";
import { MockLlm } from "../src/server/agent/mock-llm.js";
import { getTask } from "../src/server/agent/runner.js";
import { proposalView } from "../src/server/services/proposals.js";
import { ALICE, count } from "./helpers.js";
import type { Ctx } from "../src/server/ctx.js";
import { Scripted, assistantEvents, quoteOf, run, setup, turn } from "./agent-helpers.js";

describe("F3: financial claims come from backend records, not model prose", () => {
  it("a fabricated payment statement never becomes the task summary or a visible assistant event", async () => {
    const lie = "Paid successfully. USD 999.00 was sent and the university received KZT 500,000.00.";
    const s = setup(new Scripted(() => turn(lie)));
    const t = await run(s);
    expect(t.state).toBe("BLOCKED");
    expect(count(s.ctx, "payments")).toBe(0);
    expect(t.summary ?? "").not.toMatch(/paid successfully|999\.00|received/i);
    expect(assistantEvents(s.ctx, t.id).join(" ")).not.toMatch(/paid successfully|999\.00/i);
    const withheld = s.ctx.db.prepare("SELECT text FROM agent_events WHERE task_id=? AND kind='assistant_withheld'").all(t.id) as { text: string }[];
    expect(withheld).toHaveLength(1);
    expect(withheld[0].text).not.toMatch(/999\.00/);
  });
  it("an unsupported amount in otherwise plausible prose is withheld", async () => {
    const ref: { ctx?: Ctx } = {};
    const driver = new Scripted((_req, n) => {
      if (n === 1) return turn("Fetching quotes.", [{ name: "get_quotes", input: {} }]);
      if (n === 2) return turn("Preparing.", [{ name: "prepare_payment", input: { quote_id: quoteOf(ref.ctx!, "C"), preference: "cheapest", reserve_usd_cents: "30000" } }]);
      return turn("Proposal ready: you will pay USD 777.77 in total.");
    });
    const s = setup(driver);
    ref.ctx = s.ctx;
    const t = await run(s);
    expect(t.state).toBe("AWAITING_APPROVAL");
    expect(t.summary).toContain("USD 1,010.00"); // derived from the stored proposal
    expect(t.summary).not.toContain("777.77");
    expect(assistantEvents(s.ctx, t.id).join(" ")).not.toContain("777.77");
  });
  it("an unsupported 'cheapest' claim on a fastest proposal is withheld; a grounded sentence passes", async () => {
    const ref: { ctx?: Ctx } = {};
    const driver = new Scripted((_req, n) => {
      if (n === 1) return turn("Fetching quotes.", [{ name: "get_quotes", input: {} }]);
      if (n === 2) return turn("Preparing.", [{ name: "prepare_payment", input: { quote_id: quoteOf(ref.ctx!, "A"), preference: "fastest", reserve_usd_cents: "30000" } }]);
      return turn("This is the cheapest option available.");
    });
    const s = setup(driver);
    ref.ctx = s.ctx;
    const t = await run(s, "Pay the invoice, prefer faster arrival, keep USD 300");
    expect(t.state).toBe("AWAITING_APPROVAL");
    expect(assistantEvents(s.ctx, t.id).join(" ")).not.toMatch(/cheapest/i);

    const ok = setup(new MockLlm());
    const t2 = await run(ok);
    expect(assistantEvents(ok.ctx, t2.id).length).toBeGreaterThan(0); // mock prose is grounded and kept
  });
  it("a completed payment summary is derived from the stored receipt", async () => {
    const s = setup(new MockLlm());
    const t = await run(s);
    const p = proposalView(s.ctx, ALICE, t.proposal_id!);
    await s.runner.approveAndResume(ALICE, "execute", t.id, p.hash);
    await s.runner.settled(t.id);
    const done = getTask(s.ctx, ALICE, t.id);
    expect(done.state).toBe("COMPLETED");
    expect(done.summary).toContain("USD 1,010.00");
    expect(done.summary).toMatch(/simulated/i);
  });
});

