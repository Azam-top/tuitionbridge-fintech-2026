// Evaluation harness: builds an isolated in-memory app instance per case, with an injected clock.
import { openDb } from "../../src/server/db";
import { loadConfig } from "../../src/server/config";
import { TestClock } from "../../src/server/clock";
import type { Ctx } from "../../src/server/ctx";
import { resetDemo } from "../../src/server/services/seed";
import { ledgerTotals } from "../../src/server/services/ledger";
import type { ScenarioId } from "../../src/server/fixtures";
import { LlmError, type LlmClient, type LlmRequest, type LlmTurn, type ToolCall } from "../../src/server/agent/types";

export const T0 = "2026-10-12T10:00:00.000Z";
export const ALICE = "usr_alice";
export const BOB = "usr_bob";

export class Harness {
  ctx: Ctx & { clock: TestClock };
  private base: { USD: bigint; KZT: bigint };
  private startUsd: bigint;
  constructor(scenario: ScenarioId, env: NodeJS.ProcessEnv = {}) {
    const clock = new TestClock(Date.parse(T0));
    this.ctx = { db: openDb(":memory:"), clock, config: loadConfig({ APP_DEMO_MODE: "1", ...env }) };
    resetDemo(this.ctx, { scenarioFor: { userId: ALICE, scenario } });
    this.base = ledgerTotals(this.ctx);
    this.startUsd = this.usd(ALICE);
  }
  /** Call after test-setup edits so conservation/debit invariants compare against the intended starting state. */
  rebaseline(): void { this.base = ledgerTotals(this.ctx); this.startUsd = this.usd(ALICE); }
  usd(owner: string): bigint {
    return BigInt((this.ctx.db.prepare("SELECT balance_minor b FROM ledger_accounts WHERE owner_user_id=? AND kind='user' AND currency='USD'").get(owner) as { b: string }).b);
  }
  paymentCount(): number { return (this.ctx.db.prepare("SELECT COUNT(*) c FROM payments").get() as { c: number }).c; }

  /** Global invariants checked after EVERY case. Any violation fails the case. */
  invariantViolations(): string[] {
    const v: string[] = [];
    const db = this.ctx.db;
    const pays = db.prepare(
      `SELECT p.id, p.proposal_id, p.approval_id, p.receipt_json, a.consumed_at, a.proposal_id AS a_prop, a.proposal_hash, pr.hash, pr.status
         FROM payments p LEFT JOIN approvals a ON a.id = p.approval_id LEFT JOIN proposals pr ON pr.id = p.proposal_id`,
    ).all() as { id: string; proposal_id: string; consumed_at: string | null; a_prop: string | null; proposal_hash: string | null; hash: string | null; status: string | null; receipt_json: string }[];
    let debited = 0n;
    for (const p of pays) {
      if (!p.consumed_at || p.a_prop !== p.proposal_id || !p.proposal_hash || p.proposal_hash !== p.hash || p.status !== "EXECUTED") v.push(`UNAUTHORIZED_PAYMENT:${p.id}`);
      const r = JSON.parse(p.receipt_json) as { totalDebitCents: string; reserveCents: string; usdBalanceAfterCents: string };
      debited += BigInt(r.totalDebitCents);
      if (BigInt(r.usdBalanceAfterCents) < BigInt(r.reserveCents)) v.push(`RESERVE_BREACH:${p.id}`);
    }
    const dupInv = db.prepare("SELECT invoice_id FROM payments GROUP BY invoice_id HAVING COUNT(*) > 1").all();
    if (dupInv.length) v.push("DUPLICATE_PAYMENT_FOR_INVOICE");
    const now = ledgerTotals(this.ctx);
    if (now.USD !== this.base.USD || now.KZT !== this.base.KZT) v.push("LEDGER_NOT_CONSERVED");
    if (this.startUsd - this.usd(ALICE) !== debited + this.otherDebits()) v.push("BALANCE_DEBIT_MISMATCH");
    const neg = db.prepare("SELECT id FROM ledger_accounts WHERE kind='user' AND CAST(balance_minor AS INTEGER) < 0").all();
    if (neg.length) v.push("NEGATIVE_USER_BALANCE");
    return v;
  }
  private otherDebits(): bigint { return 0n; }
}

/** Scriptable fake provider for adversarial and failure cases (adapter-independent, deterministic). */
export class Scripted implements LlmClient {
  readonly mode = "LIVE" as const; // a scripted stand-in for the adapter interface; the report labels these cases "scripted"
  readonly model = "scripted-eval-model";
  calls = 0;
  constructor(private fn: (req: LlmRequest, n: number) => LlmTurn | Promise<LlmTurn>) {}
  async complete(req: LlmRequest): Promise<LlmTurn> { return this.fn(req, ++this.calls); }
}
export const turn = (text: string, calls: Omit<ToolCall, "id">[] = []): LlmTurn => ({
  text, toolCalls: calls.map((c, i) => ({ ...c, id: `t${Math.random().toString(36).slice(2)}${i}` })), usage: null, stop: calls.length ? "tool_use" : "end",
});
export const transient = (msg = "HTTP 529") => new LlmError(msg, true, 529);
