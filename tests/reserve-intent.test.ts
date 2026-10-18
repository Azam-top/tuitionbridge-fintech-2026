// Reserve parsing does not silently reinterpret instructions (audit F5).
import { describe, expect, it } from "vitest";
import { MockLlm } from "../src/server/agent/mock-llm.js";
import { parseInstruction } from "../src/shared/intent.js";
import { resolveIntent } from "../src/server/agent/intent.js";
import { PolicyError } from "../src/server/errors.js";
import { ALICE, count } from "./helpers.js";
import { EN, setup } from "./agent-helpers.js";

describe("F5: reserve parsing does not silently reinterpret instructions", () => {
  const conflict = (text: string) => parseInstruction(text).ambiguous.length > 0;
  it("rejects an unsupported reserve currency instead of reading it as USD", () => {
    for (const t of ["cheapest feasible route, keep EUR 500", "keep 500 euros", "keep €500", "keep KZT 200000", "оставь 500 евро", "оставь 100000 тенге"]) {
      expect(conflict(t), t).toBe(true);
    }
  });
  it("rejects conflicting reserve amounts", () => {
    expect(conflict("cheapest feasible route, keep USD 300 and leave USD 500 for rent")).toBe(true);
    expect(conflict("keep 300 USD and also reserve 500 USD")).toBe(true);
  });
  it("still accepts supported English and Russian forms, and repeated equal amounts", () => {
    expect(parseInstruction(EN).reserveCents).toBe("30000");
    expect(parseInstruction("Pay the invoice, prefer faster arrival, keep $450.50 reserve")).toMatchObject({ reserveCents: "45050", ambiguous: [] });
    expect(parseInstruction("keep 300 USD").reserveCents).toBe("30000");
    expect(parseInstruction("Оплати счёт до срока, выбери самый дешёвый вариант и оставь 300 долларов на жизнь.")).toMatchObject({ reserveCents: "30000", ambiguous: [], preference: "cheapest" });
    expect(parseInstruction("keep USD 300, I mean leave USD 300").ambiguous).toEqual([]);
  });
  it("surfaces the conflict as INTENT_CONFLICT when a task is started", async () => {
    let code = "NO_ERROR";
    try { resolveIntent("cheapest feasible route, keep EUR 500", "30000"); } catch (e) { if (e instanceof PolicyError) code = e.code; }
    expect(code).toBe("INTENT_CONFLICT");
    const s = setup(new MockLlm());
    expect(() => s.runner.startTask(ALICE, "execute", s.invoiceId, "cheapest feasible route, keep EUR 500")).toThrow(/USD/);
    expect(count(s.ctx, "agent_tasks")).toBe(0);
  });
});

