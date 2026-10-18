import { openDb } from "../src/server/db.js";
import { loadConfig } from "../src/server/config.js";
import { TestClock } from "../src/server/clock.js";
import type { Ctx } from "../src/server/ctx.js";
import { resetDemo } from "../src/server/services/seed.js";
import { confirmInvoice, listInvoices } from "../src/server/services/invoices.js";
import { issueQuotes } from "../src/server/services/quotes.js";
import { prepareProposal, approveProposal, type ProposalView } from "../src/server/services/proposals.js";
import type { ScenarioId } from "../src/server/fixtures.js";

export const T0 = "2026-10-12T10:00:00.000Z";
export const ALICE = "usr_alice";
export const BOB = "usr_bob";

export function makeCtx(scenario: ScenarioId = "standard", env: NodeJS.ProcessEnv = {}): Ctx & { clock: TestClock } {
  const clock = new TestClock(Date.parse(T0));
  const ctx = { db: openDb(":memory:"), clock, config: loadConfig({ APP_DEMO_MODE: "1", ...env }) };
  resetDemo(ctx, { scenarioFor: { userId: ALICE, scenario } });
  return ctx;
}

export function confirmedInvoiceId(ctx: Ctx, owner = ALICE): string {
  const inv = listInvoices(ctx, owner)[0];
  const r = confirmInvoice(ctx, owner, inv.id);
  if (r.status !== "CONFIRMED") throw new Error(`invoice not confirmed: ${JSON.stringify(r.issues)}`);
  return inv.id;
}

export function quoteIdFor(ctx: Ctx, invoiceId: string, provider: "A" | "B" | "C", owner = ALICE): string {
  const quotes = issueQuotes(ctx, owner, invoiceId);
  return quotes.find((q) => q.providerId === provider)!.id;
}

/** invoice confirmed -> quotes -> proposal (provider C by default). */
export function proposalFor(ctx: Ctx, opts: { owner?: string; provider?: "A" | "C"; reserve?: string; invoiceId?: string } = {}): ProposalView {
  const owner = opts.owner ?? ALICE;
  const invoiceId = opts.invoiceId ?? confirmedInvoiceId(ctx, owner);
  const quoteId = quoteIdFor(ctx, invoiceId, opts.provider ?? "C", owner);
  // A is the fastest route and C the cheapest; the server enforces that the chosen quote wins the stated objective.
  const preference = (opts.provider ?? "C") === "A" ? "fastest" : "cheapest";
  return prepareProposal(ctx, { ownerId: owner, tier: "propose", invoiceId, quoteId, preference, reserveCents: opts.reserve ?? "30000" });
}

export function approvedProposal(ctx: Ctx, opts: Parameters<typeof proposalFor>[1] = {}) {
  const p = proposalFor(ctx, opts);
  const owner = opts.owner ?? ALICE;
  const v = approveProposal(ctx, { ownerId: owner, tier: "execute", proposalId: p.id, proposalHash: p.hash });
  return { proposal: v, approvalId: v.approval!.id };
}

export function balance(ctx: Ctx, owner: string, ccy: "USD" | "KZT"): bigint {
  const r = ctx.db.prepare("SELECT balance_minor FROM ledger_accounts WHERE owner_user_id=? AND kind='user' AND currency=?").get(owner, ccy) as { balance_minor: string };
  return BigInt(r.balance_minor);
}
export const count = (ctx: Ctx, table: string): number => (ctx.db.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as { c: number }).c;
