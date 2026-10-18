import { describe, expect, it } from "vitest";
import { executePayment, executionPayloadHash } from "../src/server/services/execution.js";
import { approveProposal, prepareProposal, hashPayload, type ProposalPayload } from "../src/server/services/proposals.js";
import { confirmInvoice, updateInvoice, listInvoices } from "../src/server/services/invoices.js";
import { issueQuotes } from "../src/server/services/quotes.js";
import { ledgerTotals } from "../src/server/services/ledger.js";
import { PolicyError } from "../src/server/errors.js";
import { ALICE, BOB, makeCtx, approvedProposal, proposalFor, balance, count, confirmedInvoiceId, quoteIdFor } from "./helpers.js";

const exec = (ctx: ReturnType<typeof makeCtx>, p: ReturnType<typeof approvedProposal>, key = "key-aaaa-0001", owner = ALICE, tier: "read" | "propose" | "execute" = "execute") =>
  executePayment(ctx, { ownerId: owner, tier, proposalId: p.proposal.id, approvalId: p.approvalId, idempotencyKey: key });
const codeOf = (fn: () => unknown): string => {
  try { fn(); } catch (e) { if (e instanceof PolicyError) return e.code; throw e; }
  return "NO_ERROR";
};

describe("happy path ledger effects", () => {
  it("moves exactly the proposed amounts and keeps ledger totals constant", () => {
    const ctx = makeCtx();
    const before = ledgerTotals(ctx);
    const p = approvedProposal(ctx);
    const { receipt, replayed } = exec(ctx, p);
    expect(replayed).toBe(false);
    expect(receipt.totalDebitCents).toBe("101000");
    expect(receipt.usdBalanceAfterCents).toBe("49000");
    expect(balance(ctx, ALICE, "USD")).toBe(49_000n);
    expect(balance(ctx, ALICE, "KZT")).toBe(0n); // USD-only scenario: the payment never touches the student's KZT account
    const uni = ctx.db.prepare("SELECT balance_minor FROM ledger_accounts WHERE id='acc_uni_kzt'").get() as { balance_minor: string };
    expect(uni.balance_minor).toBe("50000000");
    expect(ledgerTotals(ctx)).toEqual(before);
    const inv = ctx.db.prepare("SELECT status FROM invoices WHERE owner_user_id=?").get(ALICE) as { status: string };
    expect(inv.status).toBe("PAID");
    expect(count(ctx, "payments")).toBe(1);
    expect(count(ctx, "ledger_entries")).toBe(4);
    expect((ctx.db.prepare("SELECT consumed_at FROM approvals").get() as { consumed_at: string | null }).consumed_at).not.toBeNull();
  });
  it("reports the rounding surplus for the faster route", () => {
    const ctx = makeCtx();
    const p = approvedProposal(ctx, { provider: "A" });
    const { receipt } = exec(ctx, p);
    expect(receipt.totalDebitCents).toBe("102511");
    expect(receipt.surplusTiyn).toBe("445");
    expect(receipt.recipientTiynCredited).toBe("50000445");
  });
});

describe("approval gate (critical)", () => {
  it("rejects execution with no approval and writes nothing", () => {
    const ctx = makeCtx();
    const p = proposalFor(ctx);
    const snap = JSON.stringify(ctx.db.prepare("SELECT * FROM ledger_accounts ORDER BY id").all());
    expect(codeOf(() => executePayment(ctx, { ownerId: ALICE, tier: "execute", proposalId: p.id, approvalId: "apr_doesnotexist", idempotencyKey: "key-aaaa-0001" }))).toBe("APPROVAL_MISSING");
    expect(JSON.stringify(ctx.db.prepare("SELECT * FROM ledger_accounts ORDER BY id").all())).toBe(snap);
    expect(count(ctx, "payments")).toBe(0);
    expect(count(ctx, "ledger_entries")).toBe(0);
    expect(count(ctx, "audit_events where event='payment.executed'")).toBe(0);
    expect(count(ctx, "audit_events where event='payment.rejected'")).toBe(1);
  });
  it("rejects a forged approval row that was not created by the approval service", () => {
    const ctx = makeCtx();
    const p = proposalFor(ctx);
    // Attacker-style: text saying "approved" or a made-up id has no authority.
    expect(codeOf(() => executePayment(ctx, { ownerId: ALICE, tier: "execute", proposalId: p.id, approvalId: "APPROVED", idempotencyKey: "key-aaaa-0002" }))).toBe("APPROVAL_MISSING");
  });
  it("rejects an approval bound to a different hash", () => {
    const ctx = makeCtx();
    const p = proposalFor(ctx);
    expect(codeOf(() => approveProposal(ctx, { ownerId: ALICE, tier: "execute", proposalId: p.id, proposalHash: "0".repeat(64) }))).toBe("APPROVAL_MISMATCH");
    // directly inserted approval with a wrong hash is also unusable
    ctx.db.prepare("INSERT INTO approvals (id, proposal_id, owner_user_id, proposal_hash, approved_at, expires_at) VALUES ('apr_forged',?,?,?,?,?)")
      .run(p.id, ALICE, "f".repeat(64), ctx.clock.now().toISOString(), new Date(ctx.clock.now().getTime() + 60_000).toISOString());
    expect(codeOf(() => executePayment(ctx, { ownerId: ALICE, tier: "execute", proposalId: p.id, approvalId: "apr_forged", idempotencyKey: "key-aaaa-0003" }))).toBe("APPROVAL_MISMATCH");
    expect(count(ctx, "payments")).toBe(0);
  });
  it("requires the execute tier for approval and execution", () => {
    const ctx = makeCtx();
    const p = proposalFor(ctx);
    expect(codeOf(() => approveProposal(ctx, { ownerId: ALICE, tier: "propose", proposalId: p.id, proposalHash: p.hash }))).toBe("FORBIDDEN_TIER");
    const a = approvedProposal(makeCtx());
    expect(codeOf(() => exec(makeCtx(), a, "key-aaaa-0004", ALICE, "propose"))).toBe("FORBIDDEN_TIER");
    expect(codeOf(() => prepareProposal(ctx, { ownerId: ALICE, tier: "read", invoiceId: p.payload.invoiceId, quoteId: p.payload.quoteId, preference: "cheapest", reserveCents: "30000" }))).toBe("FORBIDDEN_TIER");
  });
  it("rejects an already-consumed approval even if every other state looks fresh", () => {
    const ctx = makeCtx();
    const p = approvedProposal(ctx);
    ctx.db.prepare("UPDATE approvals SET consumed_at = ? WHERE id = ?").run(ctx.clock.now().toISOString(), p.approvalId);
    expect(codeOf(() => exec(ctx, p, "key-aaaa-0009"))).toBe("APPROVAL_CONSUMED");
    expect(count(ctx, "payments")).toBe(0);
  });
  it("rejects an expired approval", () => {
    const ctx = makeCtx();
    const p = approvedProposal(ctx);
    ctx.clock.advanceMs(ctx.config.approvalTtlMs + 1000);
    expect(codeOf(() => exec(ctx, p))).toMatch(/APPROVAL_EXPIRED|PROPOSAL_EXPIRED/);
    expect(count(ctx, "payments")).toBe(0);
  });
  it("rejects an expired quote even with a valid approval", () => {
    const ctx = makeCtx("standard", { APP_APPROVAL_TTL_MS: "3600000", APP_QUOTE_TTL_MS: "60000" });
    const p = approvedProposal(ctx);
    ctx.clock.advanceMs(61_000);
    const code = codeOf(() => exec(ctx, p));
    expect(["PROPOSAL_EXPIRED", "QUOTE_EXPIRED", "APPROVAL_EXPIRED"]).toContain(code);
    expect(balance(ctx, ALICE, "USD")).toBe(150_000n);
  });
});

describe("immutability and changed critical fields", () => {
  it("makes proposal fields immutable at the database level", () => {
    const ctx = makeCtx();
    const p = proposalFor(ctx);
    expect(() => ctx.db.prepare("UPDATE proposals SET payload_json='{}' WHERE id=?").run(p.id)).toThrow(/immutable/);
    expect(() => ctx.db.prepare("UPDATE proposals SET hash='x' WHERE id=?").run(p.id)).toThrow(/immutable/);
  });
  it("detects tampering that bypasses the trigger (defense in depth)", () => {
    const ctx = makeCtx();
    const p = approvedProposal(ctx);
    ctx.db.exec("DROP TRIGGER proposals_immutable");
    const tampered = { ...p.proposal.payload, totalDebitCents: "1" } satisfies ProposalPayload;
    ctx.db.prepare("UPDATE proposals SET payload_json=? WHERE id=?").run(JSON.stringify(tampered), p.proposal.id);
    expect(codeOf(() => exec(ctx, p))).toBe("PROPOSAL_TAMPERED");
    expect(balance(ctx, ALICE, "USD")).toBe(150_000n);
  });
  it("editing the invoice supersedes the proposal and voids its approval", () => {
    const ctx = makeCtx();
    const p = approvedProposal(ctx);
    updateInvoice(ctx, ALICE, p.proposal.payload.invoiceId, { amountKztTiyn: "40000000" });
    expect(codeOf(() => exec(ctx, p))).toBe("PROPOSAL_NOT_PENDING");
    expect(count(ctx, "payments")).toBe(0);
  });
  it("a refreshed quote needs a new proposal and a new approval", () => {
    const ctx = makeCtx();
    const first = approvedProposal(ctx);
    const inv = first.proposal.payload.invoiceId;
    const q2 = quoteIdFor(ctx, inv, "C");
    const second = prepareProposal(ctx, { ownerId: ALICE, tier: "propose", invoiceId: inv, quoteId: q2, preference: "cheapest", reserveCents: "30000" });
    expect(second.id).not.toBe(first.proposal.id);
    expect(codeOf(() => exec(ctx, first))).toBe("PROPOSAL_NOT_PENDING"); // old one superseded
    expect(codeOf(() => executePayment(ctx, { ownerId: ALICE, tier: "execute", proposalId: second.id, approvalId: first.approvalId, idempotencyKey: "key-aaaa-0005" }))).toBe("APPROVAL_MISMATCH");
  });
  it("proposal hash covers every critical field", () => {
    const ctx = makeCtx();
    const base = proposalFor(ctx).payload;
    const h = hashPayload(base);
    for (const [k, v] of Object.entries({ beneficiaryAccount: "KZ99X", totalDebitCents: "1", recipientTiyn: "1", rate: "400", reserveCents: "0", deadlineAt: "2030-01-01T00:00:00.000Z", quoteId: "q_x" })) {
      expect(hashPayload({ ...base, [k]: v })).not.toBe(h);
    }
  });
});

describe("cross-user access (critical)", () => {
  it("another user cannot read, approve, or execute someone else's proposal", () => {
    const ctx = makeCtx();
    const p = approvedProposal(ctx);
    expect(codeOf(() => executePayment(ctx, { ownerId: BOB, tier: "execute", proposalId: p.proposal.id, approvalId: p.approvalId, idempotencyKey: "key-bbbb-0001" }))).toBe("NOT_FOUND");
    const pending = proposalFor(makeCtx());
    const ctx2 = makeCtx();
    const p2 = proposalFor(ctx2);
    expect(codeOf(() => approveProposal(ctx2, { ownerId: BOB, tier: "execute", proposalId: p2.id, proposalHash: p2.hash }))).toBe("NOT_FOUND");
    expect(pending.id).toBeTruthy();
    expect(count(ctx, "payments")).toBe(0);
  });
  it("another user cannot use my invoice or quote to prepare a proposal", () => {
    const ctx = makeCtx();
    const invoiceId = confirmedInvoiceId(ctx, ALICE);
    const quoteId = quoteIdFor(ctx, invoiceId, "C", ALICE);
    expect(codeOf(() => prepareProposal(ctx, { ownerId: BOB, tier: "propose", invoiceId, quoteId, preference: "cheapest", reserveCents: "30000" }))).toBe("NOT_FOUND");
    expect(codeOf(() => issueQuotes(ctx, BOB, invoiceId))).toBe("NOT_FOUND");
    expect(codeOf(() => updateInvoice(ctx, BOB, invoiceId, { amountKztTiyn: "1000000" }))).toBe("NOT_FOUND");
    expect(codeOf(() => confirmInvoice(ctx, BOB, invoiceId))).toBe("NOT_FOUND");
  });
});

describe("idempotency and duplicates (critical)", () => {
  it("same key + same payload returns the original receipt without a second debit", () => {
    const ctx = makeCtx();
    const p = approvedProposal(ctx);
    const first = exec(ctx, p, "key-same-0001");
    const again = exec(ctx, p, "key-same-0001");
    expect(again.replayed).toBe(true);
    expect(again.receipt.paymentId).toBe(first.receipt.paymentId);
    expect(balance(ctx, ALICE, "USD")).toBe(49_000n);
    expect(count(ctx, "payments")).toBe(1);
  });
  it("same key + different payload fails", () => {
    const ctx = makeCtx();
    const p1 = approvedProposal(ctx);
    exec(ctx, p1, "key-same-0002");
    // a second, different payload with the same key
    const input = { ownerId: ALICE, tier: "execute" as const, proposalId: p1.proposal.id, approvalId: "apr_other_0001", idempotencyKey: "key-same-0002" };
    expect(codeOf(() => executePayment(ctx, input))).toBe("IDEMPOTENCY_CONFLICT");
    expect(executionPayloadHash(input, p1.proposal.hash)).not.toBe(executionPayloadHash({ ...input, approvalId: p1.approvalId }, p1.proposal.hash));
  });
  it("a different key cannot pay the same invoice or reuse the proposal/approval", () => {
    const ctx = makeCtx();
    const p = approvedProposal(ctx);
    exec(ctx, p, "key-diff-0001");
    expect(codeOf(() => exec(ctx, p, "key-diff-0002"))).toBe("DUPLICATE_PAYMENT");
    expect(balance(ctx, ALICE, "USD")).toBe(49_000n);
    expect(count(ctx, "payments")).toBe(1);
    expect(count(ctx, "idempotency_keys")).toBe(1);
  });
  it("a second proposal+approval for an already-paid invoice cannot pay again", () => {
    const ctx = makeCtx();
    const p = approvedProposal(ctx);
    exec(ctx, p, "key-diff-0003");
    const invId = p.proposal.payload.invoiceId;
    expect(codeOf(() => issueQuotes(ctx, ALICE, invId))).toBe("INVOICE_ALREADY_PAID");
    // forge a fresh proposal+approval row set directly in the DB
    const payload = p.proposal.payload;
    ctx.db.prepare("INSERT INTO proposals (id, owner_user_id, invoice_id, quote_id, hash, payload_json, display_json, status, created_at, expires_at) VALUES ('prop_f',?,?,?,?,?,?, 'PENDING', ?, ?)")
      .run(ALICE, invId, payload.quoteId, p.proposal.hash, JSON.stringify(payload), "{}", ctx.clock.now().toISOString(), payload.proposalExpiresAt);
    ctx.db.prepare("INSERT INTO approvals (id, proposal_id, owner_user_id, proposal_hash, approved_at, expires_at) VALUES ('apr_f','prop_f',?,?,?,?)")
      .run(ALICE, p.proposal.hash, ctx.clock.now().toISOString(), payload.proposalExpiresAt);
    expect(codeOf(() => executePayment(ctx, { ownerId: ALICE, tier: "execute", proposalId: "prop_f", approvalId: "apr_f", idempotencyKey: "key-diff-0004" }))).toBe("DUPLICATE_PAYMENT");
    expect(balance(ctx, ALICE, "USD")).toBe(49_000n);
  });
});

describe("funds, reserve and concurrency (critical)", () => {
  it("refuses when the balance changed so the reserve would be breached, without partial writes", () => {
    const ctx = makeCtx();
    const p = approvedProposal(ctx);
    ctx.db.prepare("UPDATE ledger_accounts SET balance_minor='120000' WHERE id='acc_usr_alice_usd'").run(); // simulate another spend
    expect(codeOf(() => exec(ctx, p))).toBe("RESERVE_BREACH");
    expect(balance(ctx, ALICE, "USD")).toBe(120_000n);
    expect(count(ctx, "payments")).toBe(0);
    expect(count(ctx, "ledger_entries")).toBe(0);
    expect((ctx.db.prepare("SELECT consumed_at FROM approvals").get() as { consumed_at: string | null }).consumed_at).toBeNull();
  });
  it("refuses with insufficient funds", () => {
    const ctx = makeCtx();
    const p = approvedProposal(ctx);
    ctx.db.prepare("UPDATE ledger_accounts SET balance_minor='50000' WHERE id='acc_usr_alice_usd'").run();
    expect(codeOf(() => exec(ctx, p))).toBe("INSUFFICIENT_FUNDS");
  });
  it("two simultaneous executions of the same approval produce exactly one payment", async () => {
    const ctx = makeCtx();
    const p = approvedProposal(ctx);
    const run = (key: string) => Promise.resolve().then(() => { try { return exec(ctx, p, key); } catch (e) { return e as PolicyError; } });
    const results = await Promise.all([run("key-conc-0001"), run("key-conc-0002"), run("key-conc-0003")]);
    const ok = results.filter((r) => !(r instanceof Error));
    expect(ok.length).toBe(1);
    expect(count(ctx, "payments")).toBe(1);
    expect(balance(ctx, ALICE, "USD")).toBe(49_000n);
  });
  it("competing payments cannot jointly breach the reserve", () => {
    const ctx = makeCtx();
    // Second invoice for the same user, so two different proposals compete for one balance.
    const first = approvedProposal(ctx);
    const inv2 = ctx.db.prepare(
      `INSERT INTO invoices (id, owner_user_id, reference, recipient_registry_id, beneficiary_name, beneficiary_account, amount_kzt_tiyn, due_at, source_type, status, created_at)
       SELECT 'inv_second', owner_user_id, 'INV-2026-0418', recipient_registry_id, beneficiary_name, beneficiary_account, amount_kzt_tiyn, due_at, 'manual', 'DRAFT', created_at FROM invoices WHERE id=?`,
    ).run(first.proposal.payload.invoiceId);
    expect(inv2.changes).toBe(1);
    confirmInvoice(ctx, ALICE, "inv_second");
    const q = quoteIdFor(ctx, "inv_second", "C");
    const prop2 = prepareProposal(ctx, { ownerId: ALICE, tier: "propose", invoiceId: "inv_second", quoteId: q, preference: "cheapest", reserveCents: "30000" });
    const ap2 = approveProposal(ctx, { ownerId: ALICE, tier: "execute", proposalId: prop2.id, proposalHash: prop2.hash });
    exec(ctx, first, "key-comp-0001");
    // 1500 - 1010 = 490 left; a second 1010 payment would need 1010 + 300 reserve.
    expect(codeOf(() => executePayment(ctx, { ownerId: ALICE, tier: "execute", proposalId: prop2.id, approvalId: ap2.approval!.id, idempotencyKey: "key-comp-0002" }))).toBe("INSUFFICIENT_FUNDS");
    expect(balance(ctx, ALICE, "USD")).toBe(49_000n);
    expect(balance(ctx, ALICE, "USD") >= 30_000n).toBe(true);
    expect(count(ctx, "payments")).toBe(1);
  });
  it("executePayment is synchronous (no await possible inside the transaction)", () => {
    expect(executePayment.constructor.name).toBe("Function");
  });
});

describe("audit trail", () => {
  it("records redacted structured events only and never a success for a rejection", () => {
    const ctx = makeCtx();
    const p = approvedProposal(ctx);
    exec(ctx, p, "key-audit-001");
    try { exec(ctx, p, "key-audit-002"); } catch { /* expected */ }
    const rows = ctx.db.prepare("SELECT event, result, refs_json FROM audit_events ORDER BY ts, rowid").all() as { event: string; result: string; refs_json: string }[];
    expect(rows.filter((r) => r.event === "payment.executed").length).toBe(1);
    expect(rows.filter((r) => r.event === "payment.rejected").length).toBe(1);
    const blob = JSON.stringify(rows);
    expect(blob).not.toMatch(/password|api[_-]?key|KZ00SANDBOX/i);
  });
  it("lists invoices only for their owner", () => {
    const ctx = makeCtx();
    expect(listInvoices(ctx, ALICE).length).toBe(1);
    expect(listInvoices(ctx, "usr_nobody").length).toBe(0);
  });
});
