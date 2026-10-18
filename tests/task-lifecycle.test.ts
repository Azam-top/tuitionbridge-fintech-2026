// Task lifecycle resilience (audit F2: cancellation is terminal; F4: payment truth survives explanation failure).
import { describe, expect, it } from "vitest";
import { getTask } from "../src/server/agent/runner.js";
import { MockLlm } from "../src/server/agent/mock-llm.js";
import { LlmError, type LlmClient, type LlmRequest, type LlmTurn } from "../src/server/agent/types.js";
import { executePayment } from "../src/server/services/execution.js";
import { proposalView } from "../src/server/services/proposals.js";
import { ALICE, balance, count } from "./helpers.js";
import { EN, run, setup } from "./agent-helpers.js";

describe("F2: cancellation is terminal", () => {
  /** Delegates to the mock agent but holds the first response until released. */
  class Gated implements LlmClient {
    readonly mode = "MOCK" as const;
    readonly model = null;
    private inner = new MockLlm();
    private release!: () => void;
    private gate = new Promise<void>((r) => { this.release = r; });
    private first = true;
    open() { this.release(); }
    async complete(req: LlmRequest): Promise<LlmTurn> {
      if (this.first) { this.first = false; await this.gate; }
      return this.inner.complete(req);
    }
  }
  it("a model response arriving after cancel does not resurrect the task or create a proposal", async () => {
    const llm = new Gated();
    const s = setup(llm);
    const t = s.runner.startTask(ALICE, "execute", s.invoiceId, EN);
    s.runner.cancel(ALICE, t.id);
    expect(getTask(s.ctx, ALICE, t.id).state).toBe("CANCELLED");
    llm.open();
    await s.runner.settled(t.id);
    const after = getTask(s.ctx, ALICE, t.id);
    expect(after.state).toBe("CANCELLED");
    expect(after.proposal_id).toBeNull();
    expect(after.tool_calls).toBe(0);
    expect(count(s.ctx, "proposals")).toBe(0);
    expect(count(s.ctx, "payments")).toBe(0);
  });
  it("a late response from a cancelled task cannot disturb a task started afterwards", async () => {
    const llm = new Gated();
    const s = setup(llm);
    const first = s.runner.startTask(ALICE, "execute", s.invoiceId, EN);
    s.runner.cancel(ALICE, first.id);
    const second = s.runner.startTask(ALICE, "execute", s.invoiceId, EN); // its first call is not gated
    await s.runner.settled(second.id);
    const secondDone = getTask(s.ctx, ALICE, second.id);
    expect(secondDone.state).toBe("AWAITING_APPROVAL");
    llm.open();
    await s.runner.settled(first.id);
    expect(getTask(s.ctx, ALICE, first.id).state).toBe("CANCELLED");
    expect(getTask(s.ctx, ALICE, second.id).state).toBe("AWAITING_APPROVAL");
    expect(proposalView(s.ctx, ALICE, secondDone.proposal_id!).status).toBe("PENDING");
    expect(count(s.ctx, "proposals")).toBe(1);
  });
});

describe("F4: an explanation failure after a committed payment does not undo the payment", () => {
  /** MockLlm that fails when asked to explain the receipt (the request after the payment tool result). */
  class FailsAfterPayment implements LlmClient {
    readonly mode = "MOCK" as const;
    readonly model = null;
    private inner = new MockLlm();
    async complete(req: LlmRequest): Promise<LlmTurn> {
      const last = req.messages.at(-1);
      if (last?.role === "tool" && last.results.some((r) => r.name === "execute_sandbox_payment")) throw new LlmError("Injected explanation outage after ledger commit.", false, 500);
      return this.inner.complete(req);
    }
  }
  /** Fails the first post-approval request, before any payment tool call. */
  class FailsBeforePayment implements LlmClient {
    readonly mode = "MOCK" as const;
    readonly model = null;
    private inner = new MockLlm();
    async complete(req: LlmRequest): Promise<LlmTurn> {
      if (req.tools.some((t) => t.name === "execute_sandbox_payment")) throw new LlmError("Injected outage before payment.", false, 500);
      return this.inner.complete(req);
    }
  }
  it("keeps the task COMPLETED with the durable receipt, and a retry cannot debit twice", async () => {
    const s = setup(new FailsAfterPayment());
    const t = await run(s);
    const p = proposalView(s.ctx, ALICE, t.proposal_id!);
    await s.runner.approveAndResume(ALICE, "execute", t.id, p.hash);
    await s.runner.settled(t.id);
    const done = getTask(s.ctx, ALICE, t.id);
    expect(done.state).toBe("COMPLETED");
    expect(done.payment_id).toBeTruthy();
    expect(done.error).toBeNull();
    expect(done.summary).toContain("USD 1,010.00");
    expect(count(s.ctx, "payments")).toBe(1);
    expect(balance(s.ctx, ALICE, "USD")).toBe(49_000n);
    const noted = s.ctx.db.prepare("SELECT text FROM agent_events WHERE task_id=? AND kind='explanation_unavailable'").all(t.id);
    expect(noted).toHaveLength(1);
    // Retrying the same idempotent execution replays the receipt; nothing is debited again.
    const approval = proposalView(s.ctx, ALICE, t.proposal_id!).approval!;
    const again = executePayment(s.ctx, { ownerId: ALICE, tier: "execute", proposalId: p.id, approvalId: approval.id, idempotencyKey: `task:${t.id}:exec`, taskId: t.id });
    expect(again.replayed).toBe(true);
    expect(count(s.ctx, "payments")).toBe(1);
    expect(balance(s.ctx, ALICE, "USD")).toBe(49_000n);
  });
  it("a genuine pre-commit failure leaves no payment and an unchanged balance", async () => {
    const s = setup(new FailsBeforePayment());
    const t = await run(s);
    const p = proposalView(s.ctx, ALICE, t.proposal_id!);
    await s.runner.approveAndResume(ALICE, "execute", t.id, p.hash);
    await s.runner.settled(t.id);
    const done = getTask(s.ctx, ALICE, t.id);
    expect(done.state).toBe("FAILED");
    expect(done.payment_id).toBeNull();
    expect(done.error).toMatch(/PROVIDER_FAILURE/);
    expect(count(s.ctx, "payments")).toBe(0);
    expect(balance(s.ctx, ALICE, "USD")).toBe(150_000n);
  });
});

