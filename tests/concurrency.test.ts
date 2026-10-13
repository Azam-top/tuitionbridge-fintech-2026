import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "../src/server/db.js";
import { loadConfig } from "../src/server/config.js";
import { TestClock } from "../src/server/clock.js";
import { resetDemo } from "../src/server/services/seed.js";
import { confirmInvoice, listInvoices } from "../src/server/services/invoices.js";
import { issueQuotes } from "../src/server/services/quotes.js";
import { approveProposal, prepareProposal } from "../src/server/services/proposals.js";
import { ALICE, T0 } from "./helpers.js";

function tmpDir(): string {
  mkdirSync(join(process.cwd(), "data"), { recursive: true }); // absent in a fresh checkout/extraction
  return mkdtempSync(join(process.cwd(), "data", "test-"));
}

function runWorker(args: string[]): Promise<{ ok: boolean; code?: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ["--import", "tsx", "tests/workers/exec-worker.ts", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; let err = "";
    p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
    p.on("close", () => { try { resolve(JSON.parse(out)); } catch { reject(new Error(`worker failed: ${out} ${err}`)); } });
  });
}

function prepare(dbPath: string) {
  const ctx = { db: openDb(dbPath), clock: new TestClock(Date.parse(T0)), config: loadConfig({ APP_DEMO_MODE: "1", APP_APPROVAL_TTL_MS: "3600000" }) };
  resetDemo(ctx);
  return ctx;
}
function approved(ctx: ReturnType<typeof prepare>, invoiceId: string) {
  confirmInvoice(ctx, ALICE, invoiceId);
  const quote = issueQuotes(ctx, ALICE, invoiceId).find((q) => q.providerId === "C")!;
  const p = prepareProposal(ctx, { ownerId: ALICE, tier: "propose", invoiceId, quoteId: quote.id, preference: "cheapest", reserveCents: "30000" });
  const a = approveProposal(ctx, { ownerId: ALICE, tier: "execute", proposalId: p.id, proposalHash: p.hash });
  return { proposalId: p.id, approvalId: a.approval!.id };
}

describe("cross-process concurrency on one SQLite file (critical)", () => {
  it("N processes racing on one approval produce exactly one payment and one debit", async () => {
    const dir = tmpDir();
    try {
      const db = join(dir, "t.sqlite");
      const ctx = prepare(db);
      const { proposalId, approvalId } = approved(ctx, listInvoices(ctx, ALICE)[0].id);
      const start = String(Date.now() + 1500);
      const results = await Promise.all([1, 2, 3, 4].map((i) => runWorker([db, ALICE, proposalId, approvalId, `key-race-000${i}`, T0, start])));
      expect(results.filter((r) => r.ok).length).toBe(1);
      expect(results.filter((r) => !r.ok).every((r) => ["DUPLICATE_PAYMENT", "PROPOSAL_NOT_PENDING", "APPROVAL_CONSUMED"].includes(r.code!))).toBe(true);
      expect((ctx.db.prepare("SELECT COUNT(*) c FROM payments").get() as { c: number }).c).toBe(1);
      expect((ctx.db.prepare("SELECT balance_minor b FROM ledger_accounts WHERE id='acc_usr_alice_usd'").get() as { b: string }).b).toBe("49000");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  it("the same idempotency key from racing processes yields one payment and the same receipt", async () => {
    const dir = tmpDir();
    try {
      const db = join(dir, "t.sqlite");
      const ctx = prepare(db);
      const { proposalId, approvalId } = approved(ctx, listInvoices(ctx, ALICE)[0].id);
      const start = String(Date.now() + 1500);
      const results = await Promise.all([1, 2, 3].map(() => runWorker([db, ALICE, proposalId, approvalId, "key-same-race1", T0, start])));
      expect(results.every((r) => r.ok)).toBe(true); // idempotent retries all succeed with the original receipt
      expect((ctx.db.prepare("SELECT COUNT(*) c FROM payments").get() as { c: number }).c).toBe(1);
      expect((ctx.db.prepare("SELECT balance_minor b FROM ledger_accounts WHERE id='acc_usr_alice_usd'").get() as { b: string }).b).toBe("49000");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  it("two different invoices racing for one balance cannot breach the reserve", async () => {
    const dir = tmpDir();
    try {
      const db = join(dir, "t.sqlite");
      const ctx = prepare(db);
      const first = listInvoices(ctx, ALICE)[0].id;
      ctx.db.prepare(
        `INSERT INTO invoices (id, owner_user_id, reference, recipient_registry_id, beneficiary_name, beneficiary_account, amount_kzt_tiyn, due_at, source_type, status, created_at)
         SELECT 'inv_second', owner_user_id, 'INV-2026-0418', recipient_registry_id, beneficiary_name, beneficiary_account, amount_kzt_tiyn, due_at, 'manual', 'DRAFT', created_at FROM invoices WHERE id=?`,
      ).run(first);
      const one = approved(ctx, first);
      const two = approved(ctx, "inv_second");
      const start = String(Date.now() + 1500);
      const results = await Promise.all([
        runWorker([db, ALICE, one.proposalId, one.approvalId, "key-comp-race1", T0, start]),
        runWorker([db, ALICE, two.proposalId, two.approvalId, "key-comp-race2", T0, start]),
      ]);
      expect(results.filter((r) => r.ok).length).toBe(1);
      expect(results.find((r) => !r.ok)!.code).toBe("INSUFFICIENT_FUNDS");
      const bal = BigInt((ctx.db.prepare("SELECT balance_minor b FROM ledger_accounts WHERE id='acc_usr_alice_usd'").get() as { b: string }).b);
      expect(bal).toBe(49_000n);
      expect(bal >= 30_000n).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);
});
