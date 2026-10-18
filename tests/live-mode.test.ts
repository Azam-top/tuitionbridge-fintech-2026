// LIVE mode: real accounts, attested recipients, provider/user-declared offers, official reference rate, payment instructions.
// No real model and no network: a scripted driver and a stub serve recorded real responses (see live-helpers.ts).
import { describe, expect, it } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/server/db.js";
import { loadConfig, agentStatus } from "../src/server/config.js";
import { createLlm } from "../src/server/agent/factory.js";
import { createRunner, getTask } from "../src/server/agent/runner.js";
import { LlmError } from "../src/server/agent/types.js";
import { PolicyError } from "../src/server/errors.js";
import { registerUser, declareFunds } from "../src/server/services/accounts.js";
import { attestRecipient } from "../src/server/services/recipients.js";
import { confirmInvoice, createInvoice } from "../src/server/services/invoices.js";
import { importInvoiceFromText } from "../src/server/services/invoice-import.js";
import { addManualOffer, listOffers, parseWiseQuote, refreshProviderOffers } from "../src/server/services/offers.js";
import { deviationBps, latestReference, parseNbkUsd, refreshReferenceRate } from "../src/server/services/reference-rate.js";
import { cancelInstruction, getInstruction, issueInstruction, markPaidByUser, uploadConfirmation } from "../src/server/services/instructions.js";
import { approveProposal, prepareProposal, proposalView } from "../src/server/services/proposals.js";
import { Scripted, turn } from "./agent-helpers.js";
import { IBAN, NBK_FIXTURE, WISE_FIXTURE, makeIban, makeLiveCtx, readyUser } from "./live-helpers.js";
import { count } from "./helpers.js";
import type { LlmRequest } from "../src/server/agent/types.js";

const codeOf = (fn: () => unknown): string => { try { fn(); } catch (e) { if (e instanceof PolicyError) return e.code; throw e; } return "NO_ERROR"; };
const codeOfAsync = async (fn: () => Promise<unknown>): Promise<string> => { try { await fn(); } catch (e) { if (e instanceof PolicyError) return e.code; throw e; } return "NO_ERROR"; };
const EN = "Pay this invoice by its deadline, use the cheapest feasible route, and keep USD 300 for living costs.";
const pdfB64 = (extra = "") => Buffer.from(`%PDF-1.4\n% test confirmation ${extra}\n%%EOF\n`).toString("base64");

describe("database mode stamp", () => {
  it("refuses to open a live database in sandbox mode and the reverse", () => {
    const dir = mkdtempSync(join(tmpdir(), "tb-mode-"));
    const path = join(dir, "x.sqlite");
    openDb(path, "live").close();
    expect(() => openDb(path, "sandbox")).toThrow(/created in live mode/);
    openDb(path, "live").close();
    const path2 = join(dir, "y.sqlite");
    openDb(path2, "sandbox").close();
    expect(() => openDb(path2, "live")).toThrow(/created in sandbox mode/);
  });
  it("defaults: live is the real mode, with separate files; APP_DEMO_MODE=1 selects the sandbox", () => {
    expect(loadConfig({}).appMode).toBe("live");
    expect(loadConfig({}).dbPath).toBe("data/live.sqlite");
    expect(loadConfig({ APP_DEMO_MODE: "1" }).appMode).toBe("sandbox");
    expect(loadConfig({ APP_MODE: "sandbox" }).dbPath).toBe("data/sandbox.sqlite");
    expect(loadConfig({ APP_MODE: "live", APP_DEMO_MODE: "1" }).appMode).toBe("live");
  });
});

describe("accounts and declared funds", () => {
  it("registers once, hashes the password, creates empty USD/KZT accounts and no demo data", () => {
    const ctx = makeLiveCtx();
    expect(count(ctx, "users")).toBe(0); // nothing is seeded in the live database
    const { userId } = registerUser(ctx, { email: "A@Example.org", displayName: "A", password: "long-enough-pw" });
    expect(count(ctx, "users")).toBe(1);
    const row = ctx.db.prepare("SELECT email, password_hash FROM users WHERE id=?").get(userId) as { email: string; password_hash: string };
    expect(row.email).toBe("a@example.org");
    expect(row.password_hash.startsWith("scrypt$")).toBe(true);
    expect(count(ctx, "ledger_accounts")).toBe(2);
    expect(codeOf(() => registerUser(ctx, { email: "a@example.org", displayName: "B", password: "long-enough-pw" }))).toBe("VALIDATION");
    expect(codeOf(() => registerUser(ctx, { email: "c@example.org", displayName: "C", password: "short" }))).toBe("VALIDATION");
    expect(count(ctx, "trusted_recipients")).toBe(0);
    expect(count(ctx, "invoices")).toBe(0);
  });
  it("registration does not exist in the sandbox", () => {
    const ctx = { ...makeLiveCtx(), config: loadConfig({ APP_MODE: "sandbox" }) };
    expect(codeOf(() => registerUser(ctx, { email: "a@example.org", displayName: "A", password: "long-enough-pw" }))).toBe("WRONG_MODE");
  });
  it("declared funds are exact, validated and cannot change while a task is active", () => {
    const ctx = makeLiveCtx();
    const { userId } = registerUser(ctx, { email: "a@example.org", displayName: "A", password: "long-enough-pw" });
    expect(declareFunds(ctx, userId, { usdBalance: "1,234.50", usdReserve: "300" })).toEqual({ usdBalanceCents: "123450", usdReserveCents: "30000" });
    for (const bad of ["12.345", "-5", "abc", "1e3", ""]) expect(codeOf(() => declareFunds(ctx, userId, { usdBalance: bad, usdReserve: "0" })), bad).toBe("VALIDATION");
    ctx.db.prepare("INSERT INTO invoices (id, owner_user_id, reference, recipient_registry_id, beneficiary_name, beneficiary_account, amount_kzt_tiyn, due_at, source_type, status, created_at) VALUES ('i1',?,'r','x','n','a','100','2030-01-01T00:00:00Z','manual','CONFIRMED','2026-01-01T00:00:00Z')").run(userId);
    ctx.db.prepare("INSERT INTO agent_tasks (id, owner_user_id, invoice_id, instruction, intent_json, state, mode, created_at, updated_at) VALUES ('t1',?,'i1','x','{}','RUNNING','LIVE','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')").run(userId);
    expect(codeOf(() => declareFunds(ctx, userId, { usdBalance: "10", usdReserve: "0" }))).toBe("TASK_ACTIVE");
  });
});

describe("attested recipients", () => {
  const good = { name: "Test University", account: IBAN, sourceUrl: "https://example.edu/payments", sourceNote: "Official payment page" };
  it("validates IBAN checksum, https source and duplicates; sandbox cannot attest", () => {
    const ctx = makeLiveCtx();
    const { userId } = registerUser(ctx, { email: "a@example.org", displayName: "A", password: "long-enough-pw" });
    const wrong = IBAN.slice(0, -1) + (IBAN.endsWith("0") ? "1" : "0");
    expect(codeOf(() => attestRecipient(ctx, userId, { ...good, account: wrong }))).toBe("VALIDATION");
    expect(codeOf(() => attestRecipient(ctx, userId, { ...good, sourceUrl: "http://example.edu/p" }))).toBe("VALIDATION");
    expect(codeOf(() => attestRecipient(ctx, userId, { ...good, sourceNote: "" }))).toBe("VALIDATION");
    const r = attestRecipient(ctx, userId, good);
    expect(r).toMatchObject({ origin: "user_attested", sourceUrl: good.sourceUrl });
    expect(codeOf(() => attestRecipient(ctx, userId, { ...good, name: "Other name" }))).toBe("VALIDATION");
    const sb = { ...ctx, config: loadConfig({ APP_MODE: "sandbox" }) };
    expect(codeOf(() => attestRecipient(sb, userId, good))).toBe("WRONG_MODE");
  });
  it("an invoice is trusted only by matching the user's attested recipient; documents cannot create recipients", () => {
    const ctx = makeLiveCtx();
    const { userId, invoice } = readyUser(ctx);
    expect(invoice.status).toBe("CONFIRMED");
    expect(invoice.recipientRegistryId).toMatch(/^rec_/); // linked from the attested entry, not typed by a document
    // same account, different name -> mismatch
    const a = createInvoice(ctx, userId, { reference: "INV-2", recipientRegistryId: "", beneficiaryName: "Another Name", beneficiaryAccount: IBAN, amountKztTiyn: "100000", dueAt: "2026-10-30T00:00:00Z" });
    expect(confirmInvoice(ctx, userId, a.id).issues.map((i) => i.code)).toContain("RECIPIENT_MISMATCH");
    // unknown account -> UNKNOWN_RECIPIENT with the live explanation
    const b = createInvoice(ctx, userId, { reference: "INV-3", recipientRegistryId: "", beneficiaryName: "Test University", beneficiaryAccount: makeIban("999KZT0000000009"), amountKztTiyn: "100000", dueAt: "2026-10-30T00:00:00Z" });
    const cb = confirmInvoice(ctx, userId, b.id);
    expect(cb.status).toBe("BLOCKED");
    expect(cb.issues.find((i) => i.code === "UNKNOWN_RECIPIENT")!.message).toMatch(/attested/);
    // an imported document that names a registry id and account cannot add itself
    const text = `Invoice No: INV-9\nRegistry ID: UNI-FAK-999\nBeneficiary: Evil University\nAccount: ${makeIban("777KZT0000000007")}\nAmount due: KZT 100,000.00\nDue date: 2026-10-30 09:00 +05:00`;
    const imp = importInvoiceFromText(ctx, userId, text, "structured");
    expect(confirmInvoice(ctx, userId, imp.id).status).toBe("BLOCKED");
    expect(count(ctx, "trusted_recipients")).toBe(1);
  });
  it("another user's attested recipient is never trusted for me", () => {
    const ctx = makeLiveCtx();
    const first = readyUser(ctx, { email: "one@example.org" });
    const { userId: other } = registerUser(ctx, { email: "two@example.org", displayName: "Two", password: "long-enough-pw" });
    const inv = createInvoice(ctx, other, { reference: "X1", recipientRegistryId: first.recipient.id, beneficiaryName: "Test University", beneficiaryAccount: IBAN, amountKztTiyn: "100000", dueAt: "2026-10-30T00:00:00Z" });
    expect(confirmInvoice(ctx, other, inv.id).status).toBe("BLOCKED");
  });
});

describe("official reference rate (NBK)", () => {
  it("parses the recorded NBK feed", () => {
    expect(parseNbkUsd(NBK_FIXTURE)).toEqual({ rate: "452.12", quantity: "1", effectiveDate: "2026-10-18" });
    expect(parseNbkUsd("<rss></rss>")).toBeNull();
  });
  it("stores the rate with source, effective date and body hash; an outage keeps the dated cache and never invents a value", async () => {
    const ctx = makeLiveCtx();
    expect(latestReference(ctx)).toBeNull();
    const r1 = await refreshReferenceRate(ctx);
    expect(r1.status).toBe("FRESH");
    expect(r1.reference).toMatchObject({ source: "NBK", rate: "452.12", effectiveDate: "2026-10-18", stale: false });
    expect(r1.reference!.bodySha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await refreshReferenceRate(ctx)).status).toBe("CACHED"); // no second request within 6 hours
    ctx.clock.advanceMs(7 * 3600_000);
    ctx.stub.nbkFail = true;
    const r2 = await refreshReferenceRate(ctx);
    expect(r2.status).toBe("UNAVAILABLE");
    expect(r2.reference!.rate).toBe("452.12"); // the old, dated value, still labeled with its retrieval time
    const empty = makeLiveCtx();
    empty.stub.nbkFail = true;
    expect((await refreshReferenceRate(empty)).reference).toBeNull();
  });
  it("computes deviation in basis points", () => {
    const ref = { source: "NBK", pair: "USD/KZT", rate: "452.12", quantity: "1", effectiveDate: "2026-10-18", retrievedAt: "x", url: "u", bodySha256: "h", stale: false } as const;
    expect(deviationBps("452.12", ref)).toBe(0);
    expect(deviationBps("445.00", ref)).toBe(-157);
  });
});

describe("Wise public quote source", () => {
  const TUITION = 50_000_000n;
  it("keeps only options reproducible by this app's own arithmetic (recorded real response)", () => {
    const opts = parseWiseQuote(WISE_FIXTURE, TUITION);
    expect(opts.map((o) => o.providerId).sort()).toEqual(["wise:BANK_TRANSFER", "wise:CREDIT", "wise:DEBIT"]);
    const bank = opts.find((o) => o.providerId === "wise:BANK_TRANSFER")!;
    expect(bank).toMatchObject({ rate: "452.22", feeCents: "1640", provenance: "PROVIDER_LIVE", expiresAt: "2026-10-18T11:18:25Z", estArrivalAt: "2026-10-22T15:20:00Z", observedAt: "2026-10-18T10:48:25Z" });
    expect(bank.externalRef).toMatch(/^wise-price:/);
    expect(bank.sourceNote).toMatch(/not guaranteed/);
  });
  it("drops an option whose total cannot be reproduced, and rejects malformed bodies", () => {
    const tampered = JSON.parse(JSON.stringify(WISE_FIXTURE)) as { paymentOptions: { payIn: string; sourceAmount: number }[] };
    tampered.paymentOptions.find((o) => o.payIn === "BANK_TRANSFER")!.sourceAmount += 0.01;
    expect(parseWiseQuote(tampered, TUITION).map((o) => o.providerId)).not.toContain("wise:BANK_TRANSFER");
    expect(parseWiseQuote({}, TUITION)).toEqual([]);
    expect(parseWiseQuote(null, TUITION)).toEqual([]);
  });
  it("fetches with only currencies and the amount, stores PROVIDER_LIVE offers, and stores nothing on failure", async () => {
    const ctx = makeLiveCtx();
    const { userId, invoice } = readyUser(ctx);
    const r = await refreshProviderOffers(ctx, userId, invoice.id);
    expect(r).toMatchObject({ status: "OK", stored: 3 });
    const call = ctx.stub.calls.find((c) => c.url.includes("wise.com"))!;
    expect(call.method).toBe("POST");
    expect(JSON.parse(call.body!)).toEqual({ sourceCurrency: "USD", targetCurrency: "KZT", sourceAmount: null, targetAmount: 500000 });
    expect(call.body).not.toMatch(/student@example|Test University|KZ\d\d/);
    expect(listOffers(ctx, userId, invoice.id).every((o) => o.provenance === "PROVIDER_LIVE")).toBe(true);
    const down = makeLiveCtx();
    down.stub.wiseFail = true;
    const u2 = readyUser(down);
    expect(await refreshProviderOffers(down, u2.userId, u2.invoice.id)).toMatchObject({ status: "UNAVAILABLE", stored: 0 });
    expect(count(down, "quotes")).toBe(0); // no substitute offer is ever created
    const off = makeLiveCtx({ APP_WISE_QUOTES: "0" });
    const u3 = readyUser(off);
    expect((await refreshProviderOffers(off, u3.userId, u3.invoice.id)).status).toBe("DISABLED");
  });
});

describe("offers entered by the user", () => {
  const base = (ctx: ReturnType<typeof makeLiveCtx>, invoiceId: string, over: Record<string, unknown> = {}) => ({
    invoiceId, providerName: "Test Bank", rate: "450", feeUsd: "12.00",
    arrivalAt: new Date(ctx.clock.now().getTime() + 2 * 86_400_000).toISOString(), validUntil: new Date(ctx.clock.now().getTime() + 3600_000).toISOString(),
    observedAt: new Date(ctx.clock.now().getTime() - 600_000).toISOString(), sourceNote: "Bank app quote screen", ...over,
  });
  it("stores source, observation time and validity, labeled USER_DECLARED", () => {
    const ctx = makeLiveCtx();
    const { userId, invoice } = readyUser(ctx);
    const q = addManualOffer(ctx, userId, base(ctx, invoice.id));
    expect(q).toMatchObject({ provenance: "USER_DECLARED", rate: "450", feeCents: "1200", sourceNote: "Bank app quote screen" });
    expect(q.providerName).toMatch(/entered by you/);
    expect(listOffers(ctx, userId, invoice.id)).toHaveLength(1);
  });
  it("rejects stale, invalid, implausible and unsourced offers", async () => {
    const ctx = makeLiveCtx();
    const { userId, invoice } = readyUser(ctx);
    await refreshReferenceRate(ctx);
    const bad: [string, Record<string, unknown>][] = [
      ["already expired", { validUntil: new Date(ctx.clock.now().getTime() - 1000).toISOString() }],
      ["valid for more than 7 days", { validUntil: new Date(ctx.clock.now().getTime() + 8 * 86_400_000).toISOString() }],
      ["arrival in the past", { arrivalAt: new Date(ctx.clock.now().getTime() - 1000).toISOString() }],
      ["seen in the future", { observedAt: new Date(ctx.clock.now().getTime() + 3600_000).toISOString() }],
      ["seen too long ago", { observedAt: new Date(ctx.clock.now().getTime() - 9 * 86_400_000).toISOString() }],
      ["rate typo (45.2 vs NBK 452.12)", { rate: "45.2" }],
      ["no source", { sourceNote: "" }],
      ["negative fee", { feeUsd: "-1" }],
      ["fee with 3 decimals", { feeUsd: "1.234" }],
      ["rate not a number", { rate: "abc" }],
    ];
    for (const [name, over] of bad) expect(codeOf(() => addManualOffer(ctx, userId, base(ctx, invoice.id, over))), name).toBe("VALIDATION");
    expect(count(ctx, "quotes")).toBe(0);
    const sb = { ...ctx, config: loadConfig({ APP_MODE: "sandbox" }) };
    expect(codeOf(() => addManualOffer(sb, userId, base(ctx, invoice.id)))).toBe("WRONG_MODE");
  });
});

/** Scripted driver standing in for a model: reads quotes, ranks, prepares the server-ranked best. */
const driver = (preference: "cheapest" | "fastest" = "cheapest") => new Scripted((req: LlmRequest, n: number) => {
  const results = new Map<string, Record<string, unknown>>();
  for (const m of req.messages) if (m.role === "tool") for (const r of m.results) results.set(r.name, JSON.parse(r.content) as Record<string, unknown>);
  if (!results.has("get_quotes")) return turn("Reading the invoice, balances and current offers.", [{ name: "parse_invoice", input: {} }, { name: "get_balances", input: {} }, { name: "get_quotes", input: {} }]);
  if (!results.has("evaluate_routes")) return turn("Ranking.", [{ name: "evaluate_routes", input: { preference, reserve_usd_cents: "30000" } }]);
  if (!results.has("prepare_payment")) {
    const best = results.get("evaluate_routes")!.bestQuoteId as string | null;
    return best ? turn("Preparing.", [{ name: "prepare_payment", input: { quote_id: best, preference, reserve_usd_cents: "30000" } }]) : turn("No route qualifies.");
  }
  return turn(`Done after ${n} requests.`);
});

describe("live agent flow: sources, approval, instruction (the app moves no money)", () => {
  async function planned(preference: "cheapest" | "fastest" = "cheapest") {
    const ctx = makeLiveCtx();
    const u = readyUser(ctx);
    addManualOffer(ctx, u.userId, {
      invoiceId: u.invoice.id, providerName: "Test Bank", rate: "450", feeUsd: "12.00",
      arrivalAt: "2026-10-20T10:00:00Z", validUntil: "2026-10-18T11:10:00Z", observedAt: "2026-10-18T10:45:00Z", sourceNote: "Bank app quote screen",
    });
    const runner = createRunner(ctx, driver(preference), { retryDelayMs: 1 });
    const t = runner.startTask(u.userId, "execute", u.invoice.id, preference === "fastest" ? "Pay by the deadline, prefer faster arrival, keep USD 300." : EN);
    await runner.settled(t.id);
    return { ctx, u, runner, task: getTask(ctx, u.userId, t.id) };
  }
  it("gathers real sources first, lets the server pick the cheapest, and binds the source into the proposal", async () => {
    const { ctx, u, task } = await planned();
    expect(task.state).toBe("AWAITING_APPROVAL");
    expect(ctx.stub.calls.map((c) => new URL(c.url).host)).toEqual(expect.arrayContaining(["nationalbank.kz", "api.wise.com"]));
    const p = proposalView(ctx, u.userId, task.proposal_id!);
    expect(p.payload.providerId).toBe("wise:BANK_TRANSFER"); // 1,122.06 beats the user's 1,123.12 offer
    expect(p.payload).toMatchObject({ quoteProvenance: "PROVIDER_LIVE", totalDebitCents: "112206", quoteObservedAt: "2026-10-18T10:48:25Z" });
    expect(p.payload.quoteSourceNote).toMatch(/Wise public quote API/);
    const events = ctx.db.prepare("SELECT text FROM agent_events WHERE task_id=? AND kind='info'").all(task.id) as { text: string }[];
    expect(events.map((e) => e.text).join(" ")).toMatch(/NBK 452\.12/);
  });
  it("the fastest preference selects the user's own earlier-arriving offer", async () => {
    const { ctx, u, task } = await planned("fastest");
    expect(task.state).toBe("AWAITING_APPROVAL");
    expect(proposalView(ctx, u.userId, task.proposal_id!).payload).toMatchObject({ providerId: "user:test-bank", quoteProvenance: "USER_DECLARED", totalDebitCents: "112312" });
  });
  it("approval issues an instruction and moves no money: no payment, no ledger entry, balance untouched", async () => {
    const { ctx, u, runner, task } = await planned();
    const p = proposalView(ctx, u.userId, task.proposal_id!);
    const done = await runner.approveAndResume(u.userId, "execute", task.id, p.hash);
    expect(done.state).toBe("APPROVED");
    expect(done.summary).toMatch(/has not moved any money/);
    expect(done.summary).not.toMatch(/paid successfully|payment completed/i);
    expect(count(ctx, "payments")).toBe(0);
    expect(count(ctx, "ledger_entries")).toBe(0);
    expect(ctx.db.prepare("SELECT balance_minor b FROM ledger_accounts WHERE owner_user_id=? AND currency='USD'").get(u.userId)).toEqual({ b: "150000" });
    expect(ctx.db.prepare("SELECT status FROM invoices WHERE id=?").get(u.invoice.id)).toEqual({ status: "INSTRUCTED" });
    const ins = ctx.db.prepare("SELECT id FROM payment_instructions").get() as { id: string };
    const v = getInstruction(ctx, u.userId, ins.id);
    expect(v.body).toMatchObject({ executedByApp: false, youPayUsdCents: "112206", payTo: { name: "Test University", account: IBAN }, invoiceReference: "INV-TEST-1" });
    expect(v.body.source.provenance).toBe("PROVIDER_LIVE");
    expect(v.progress).toBe("INSTRUCTION_ISSUED");
    // the invoice is locked: no second plan, no edit
    expect(() => runner.startTask(u.userId, "execute", u.invoice.id, EN)).toThrow(/already paid or has a payment instruction/);
    // approving again cannot issue a second instruction
    await expect(runner.approveAndResume(u.userId, "execute", task.id, p.hash)).rejects.toMatchObject({ code: "TASK_STATE" });
    expect(count(ctx, "payment_instructions")).toBe(1);
  });
  it("an expired offer cannot become an instruction", async () => {
    const { ctx, u, runner, task } = await planned();
    const p = proposalView(ctx, u.userId, task.proposal_id!);
    ctx.clock.advanceMs(40 * 60_000); // past the Wise quote expiry (30 minutes)
    expect(await codeOfAsync(() => runner.approveAndResume(u.userId, "execute", task.id, p.hash))).toMatch(/PROPOSAL_EXPIRED|QUOTE_EXPIRED|APPROVAL_EXPIRED/);
    expect(count(ctx, "payment_instructions")).toBe(0);
  });
  it("issueInstruction refuses without a human approval", async () => {
    const { ctx, u, task } = await planned();
    expect(codeOf(() => issueInstruction(ctx, { ownerId: u.userId, tier: "execute", proposalId: task.proposal_id! }))).toBe("APPROVAL_MISSING");
    expect(codeOf(() => issueInstruction(ctx, { ownerId: u.userId, tier: "propose", proposalId: task.proposal_id! }))).toBe("FORBIDDEN_TIER");
  });
  it("the sandbox ledger path is unreachable in live mode", async () => {
    const { ctx, u, task } = await planned();
    const p = proposalView(ctx, u.userId, task.proposal_id!);
    approveProposal(ctx, { ownerId: u.userId, tier: "execute", proposalId: p.id, proposalHash: p.hash });
    expect(codeOf(() => issueInstruction({ ...ctx, config: loadConfig({ APP_MODE: "sandbox" }) }, { ownerId: u.userId, tier: "execute", proposalId: p.id }))).toBe("WRONG_MODE");
  });
});

describe("user evidence is never presented as bank verification", () => {
  async function instructed() {
    const ctx = makeLiveCtx();
    const u = readyUser(ctx);
    await refreshProviderOffers(ctx, u.userId, u.invoice.id);
    const best = listOffers(ctx, u.userId, u.invoice.id).find((o) => o.providerName.includes("bank transfer"))!;
    const p = prepareProposal(ctx, { ownerId: u.userId, tier: "propose", invoiceId: u.invoice.id, quoteId: best.id, preference: "cheapest", reserveCents: "30000" });
    approveProposal(ctx, { ownerId: u.userId, tier: "execute", proposalId: p.id, proposalHash: p.hash });
    return { ctx, u, ins: issueInstruction(ctx, { ownerId: u.userId, tier: "execute", proposalId: p.id }) };
  }
  it("a manual mark is labeled as the user's own statement; an upload is stored, hashed and not verified", async () => {
    const { ctx, u, ins } = await instructed();
    const marked = markPaidByUser(ctx, u.userId, ins.id, { reference: "WISE-123" });
    expect(marked.progress).toBe("MARKED_PAID_BY_USER");
    expect(marked.progressLabel).toMatch(/not verified by a bank/);
    expect(marked.evidence[0].label).toMatch(/your own statement/);
    expect(codeOf(() => markPaidByUser(ctx, u.userId, ins.id, {}))).toBe("VALIDATION");
    const up = uploadConfirmation(ctx, u.userId, ins.id, { filename: "../../etc/confirmation.pdf", dataBase64: pdfB64() });
    expect(up.progress).toBe("CONFIRMATION_FILE_UPLOADED");
    const ev = up.evidence.find((e) => e.kind === "bank_confirmation_upload")!;
    expect(ev).toMatchObject({ mime: "application/pdf", filename: ".._.._etc_confirmation.pdf" });
    expect(ev.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(ev.label).toMatch(/did not verify/);
    const stored = ctx.db.prepare("SELECT stored_path FROM payment_evidence WHERE kind='bank_confirmation_upload'").get() as { stored_path: string };
    expect(existsSync(stored.stored_path)).toBe(true);
    expect(readFileSync(stored.stored_path).toString()).toContain("%PDF-");
    const every = JSON.stringify(up);
    // negated wording ("not verified by a bank") is the point; affirmative bank-verification wording must never appear
    expect(every).not.toMatch(/confirmed by (the )?bank|bank[- ]confirmed|(?<!not )verified by/i);
  });
  it("accepts only PDF/PNG/JPEG by signature and within the size cap", async () => {
    const { ctx, u, ins } = await instructed();
    const fake = Buffer.from("<html>not a pdf</html>").toString("base64");
    expect(codeOf(() => uploadConfirmation(ctx, u.userId, ins.id, { filename: "a.pdf", dataBase64: fake }))).toBe("VALIDATION");
    const tooBig = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(ctx.config.maxUploadBytes)]).toString("base64");
    expect(codeOf(() => uploadConfirmation(ctx, u.userId, ins.id, { filename: "a.pdf", dataBase64: tooBig }))).toBe("VALIDATION");
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]).toString("base64");
    expect(uploadConfirmation(ctx, u.userId, ins.id, { filename: "s.png", dataBase64: png }).evidence[0].mime).toBe("image/png");
    expect(count(ctx, "payment_evidence")).toBe(1);
  });
  it("evidence belongs to its owner, and a cancel is allowed only before evidence exists", async () => {
    const { ctx, u, ins } = await instructed();
    const { userId: other } = registerUser(ctx, { email: "other@example.org", displayName: "O", password: "long-enough-pw" });
    expect(codeOf(() => getInstruction(ctx, other, ins.id))).toBe("NOT_FOUND");
    expect(codeOf(() => markPaidByUser(ctx, other, ins.id, {}))).toBe("NOT_FOUND");
    expect(codeOf(() => uploadConfirmation(ctx, other, ins.id, { filename: "a.pdf", dataBase64: pdfB64() }))).toBe("NOT_FOUND");
    expect(codeOf(() => cancelInstruction(ctx, other, ins.id))).toBe("NOT_FOUND");
    markPaidByUser(ctx, u.userId, ins.id, {});
    expect(codeOf(() => cancelInstruction(ctx, u.userId, ins.id))).toBe("VALIDATION");
  });
  it("cancelling an untouched instruction frees the invoice for a new plan", async () => {
    const { ctx, u, ins } = await instructed();
    const c = cancelInstruction(ctx, u.userId, ins.id);
    expect(c.progress).toBe("CANCELLED");
    expect(ctx.db.prepare("SELECT status FROM invoices WHERE id=?").get(u.invoice.id)).toEqual({ status: "CONFIRMED" });
    expect(codeOf(() => markPaidByUser(ctx, u.userId, ins.id, {}))).toBe("TASK_STATE");
  });
});

describe("no stand-in model in the live mode", () => {
  it("without a key the live mode reports NOT_CONFIGURED, refuses tasks, and the factory never returns the MOCK agent", async () => {
    const ctx = makeLiveCtx({ APP_LLM_API_KEY: "", APP_LLM_MODEL: "" });
    expect(agentStatus(ctx.config)).toBe("NOT_CONFIGURED");
    const u = readyUser(ctx);
    const llm = createLlm(ctx.config);
    expect(llm.constructor.name).not.toBe("MockLlm");
    await expect(llm.complete({ system: "", messages: [], tools: [], maxTokens: 1 })).rejects.toBeInstanceOf(LlmError);
    const runner = createRunner(ctx, llm);
    expect(codeOf(() => runner.startTask(u.userId, "execute", u.invoice.id, EN))).toBe("AGENT_NOT_CONFIGURED");
    expect(count(ctx, "agent_tasks")).toBe(0);
  });
  it("the sandbox keeps its labeled MOCK agent", () => {
    expect(agentStatus(loadConfig({ APP_MODE: "sandbox" }))).toBe("MOCK");
    expect(createLlm(loadConfig({ APP_MODE: "sandbox" })).constructor.name).toBe("MockLlm");
  });
});
