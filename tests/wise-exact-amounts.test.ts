// Wise quotes carry the provider's own amounts end to end: stored exactly, ranked, bound into the proposal hash, re-checked and shown
// unchanged. No rebuild from the rate, no tolerance. No model and no network: a stub serves recorded (or derived, labeled) responses.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/server/db.js";
import { MoneyError, exactDecimalToMinor } from "../src/shared/money.js";
import { evaluateQuote, evaluateRoutes, type QuoteRecord } from "../src/shared/policy.js";
import { PolicyError } from "../src/server/errors.js";
import { impliedRate, parseWiseBody, parseWiseQuote, refreshProviderOffers } from "../src/server/services/offers.js";
import { latestQuotesForInvoice } from "../src/server/services/quotes.js";
import { approveProposal, hashPayload, prepareProposal, proposalView, type ProposalPayload } from "../src/server/services/proposals.js";
import { getInstruction, issueInstruction } from "../src/server/services/instructions.js";
import { WISE_FIXTURE, makeLiveCtx, readyUser } from "./live-helpers.js";

const load = (f: string) => JSON.parse(readFileSync(`tests/fixtures/${f}`, "utf8")) as Record<string, unknown>;
const ROUNDING = load("wise-quote-usd-kzt.rounding-case.derived-2026-10-20.json"); // rate 450.295: the old exact-total rule dropped every option
const FRESH = load("wise-quote-usd-kzt.recorded-2026-10-20.json"); // a real response recorded 2026-10-20 12:13 UTC
const TUITION = 50_000_000n;
const AT_ROUNDING = "2026-10-20T12:00:00.000Z"; // inside the rounding fixture's validity window (11:58:26Z to 12:28:26Z)
const AT_FRESH = "2026-10-20T12:20:00.000Z"; // inside the fresh recording's window (12:13:29Z to 12:43:29Z)
const codeOf = (fn: () => unknown): string => { try { fn(); } catch (e) { if (e instanceof PolicyError) return e.code; throw e; } return "NO_ERROR"; };

describe("exact decimal to minor units", () => {
  it("converts decimals exactly, from text or from the JSON number's decimal form", () => {
    expect(exactDecimalToMinor("1126.82")).toBe(112682n);
    expect(exactDecimalToMinor(1126.82)).toBe(112682n);
    expect(exactDecimalToMinor(500000)).toBe(50000000n);
    expect(exactDecimalToMinor("0.07")).toBe(7n);
    expect(exactDecimalToMinor("16.4")).toBe(1640n);
    expect(exactDecimalToMinor("0", "fee", true)).toBe(0n);
    // the classic float traps are exact here
    expect(exactDecimalToMinor(1.15)).toBe(115n);
    expect(exactDecimalToMinor(8.2)).toBe(820n);
    expect(exactDecimalToMinor(1234567890123.45)).toBe(123456789012345n);
  });
  it("refuses anything it cannot represent exactly instead of rounding it", () => {
    for (const bad of ["1126.825", "1e3", "1.5e-7", "-1", "+1", "1,126.82", " 1", "", "abc", "12345678901234", NaN, Infinity, null, undefined, {}, 1e21, 0.1 + 0.2]) {
      expect(() => exactDecimalToMinor(bad), String(bad)).toThrow(MoneyError);
    }
    expect(() => exactDecimalToMinor("0")).toThrow(/positive/);
  });
  it("the Wise parser no longer rounds money through floating point", () => {
    expect(readFileSync("src/server/services/offers.ts", "utf8")).not.toMatch(/Math\.round\([^)]*\*\s*100/);
  });
});

describe("regression: a Wise quote whose displayed rate is rounded (1 cent from the app's own recomputation)", () => {
  it("keeps all three options with Wise's exact total, fee and credit", () => {
    const opts = parseWiseQuote(ROUNDING, TUITION);
    const by = Object.fromEntries(opts.map((o) => [o.providerId, o]));
    expect(Object.keys(by).sort()).toEqual(["wise:BANK_TRANSFER", "wise:CREDIT", "wise:DEBIT"]);
    expect(by["wise:BANK_TRANSFER"]).toMatchObject({ rate: "450.295", feeCents: "1644", providerAmounts: { sourceTotalCents: "112682", targetTiyn: "50000000" } });
    expect(by["wise:DEBIT"]).toMatchObject({ feeCents: "2421", providerAmounts: { sourceTotalCents: "113459", targetTiyn: "50000000" } });
    expect(by["wise:CREDIT"]).toMatchObject({ feeCents: "8328", providerAmounts: { sourceTotalCents: "119366", targetTiyn: "50000000" } });
    // the rate-based recomputation would have said 112,683: this is exactly the 1 cent that used to drop every option
    const principalFromRate = (TUITION * 1000n + 450295n - 1n) / 450295n * 1n; // ceil(tiyn / 450.295), in cents
    expect(principalFromRate + 1644n).toBe(112683n);
    expect(BigInt(by["wise:BANK_TRANSFER"].providerAmounts!.sourceTotalCents)).toBe(112682n);
  });
  it("is stored, ranked, and its amounts are Wise's, not a recomputation", async () => {
    const ctx = makeLiveCtx({}, AT_ROUNDING);
    ctx.stub.wise = ROUNDING;
    const u = readyUser(ctx);
    expect(await refreshProviderOffers(ctx, u.userId, u.invoice.id)).toMatchObject({ status: "OK", stored: 3 });
    const quotes = latestQuotesForInvoice(ctx, u.userId, u.invoice.id);
    const bank = quotes.find((q) => q.providerId === "wise:BANK_TRANSFER")!;
    expect(bank.providerAmounts).toEqual({ sourceTotalCents: "112682", targetTiyn: "50000000" });
    const input = { tuitionTiyn: TUITION, deadlineAt: u.invoice.dueAt, now: AT_ROUNDING, usdBalanceCents: 150000n, usdReserveCents: 30000n };
    const res = evaluateRoutes({ quotes, ...input, preference: "cheapest" });
    expect(res.best!.providerId).toBe("wise:BANK_TRANSFER");
    expect(res.best).toMatchObject({ totalDebitCents: "112682", feeCents: "1644", principalCents: "111038", recipientTiyn: "50000000", surplusTiyn: "0", feasible: true });
  });
  it("the fresh real recording is stored with Wise's own numbers as well", async () => {
    const ctx = makeLiveCtx({}, AT_FRESH);
    ctx.stub.wise = FRESH;
    const u = readyUser(ctx);
    expect(await refreshProviderOffers(ctx, u.userId, u.invoice.id)).toMatchObject({ status: "OK", stored: 3 });
    const q = Object.fromEntries(latestQuotesForInvoice(ctx, u.userId, u.invoice.id).map((x) => [x.providerId, x]));
    expect(q["wise:BANK_TRANSFER"]).toMatchObject({ rate: "450.305", feeCents: "1644", providerAmounts: { sourceTotalCents: "112680", targetTiyn: "50000000" } });
    expect(q["wise:DEBIT"].providerAmounts).toEqual({ sourceTotalCents: "113457", targetTiyn: "50000000" });
    expect(q["wise:CREDIT"].providerAmounts).toEqual({ sourceTotalCents: "119364", targetTiyn: "50000000" });
  });
});

describe("what the parser keeps and drops", () => {
  const base = () => JSON.parse(JSON.stringify(ROUNDING)) as { rate: number | string; paymentOptions: Record<string, unknown>[]; [k: string]: unknown };
  const ids = (j: unknown) => parseWiseQuote(j, TUITION).map((o) => o.providerId).sort();
  it("reads the amounts from the response text, so trailing zeros or digits cannot be lost to a float", () => {
    const text = JSON.stringify(ROUNDING).replace('"sourceAmount":1126.82', '"sourceAmount":1126.820');
    const parsed = parseWiseBody(text) as { paymentOptions: { sourceAmount: unknown }[] };
    expect(typeof parsed.paymentOptions[0].sourceAmount === "string" || typeof parsed.paymentOptions[0].sourceAmount === "number").toBe(true);
    // 1126.820 (three decimals, even with a zero) is not an exact two-decimal amount: that option is refused, not rounded
    expect(ids(parseWiseBody(text))).not.toContain("wise:BANK_TRANSFER");
    expect(ids(parseWiseBody(JSON.stringify(ROUNDING)))).toContain("wise:BANK_TRANSFER");
  });
  it("drops options with a third decimal, an exponent, a missing or non-positive amount, or a total that does not exceed the fee", () => {
    for (const [field, value] of [["sourceAmount", 1126.825], ["sourceAmount", "1.12682e3"], ["sourceAmount", null], ["targetAmount", 0], ["targetAmount", undefined], ["sourceAmount", 16.44]] as const) {
      const j = base();
      (j.paymentOptions[0] as Record<string, unknown>)[field] = value;
      expect(ids(j), `${field}=${String(value)}`).not.toContain("wise:BANK_TRANSFER");
      expect(ids(j)).toContain("wise:DEBIT"); // the others are unaffected
    }
    const j = base();
    (j.paymentOptions[0].fee as Record<string, unknown>).total = 16.445;
    expect(ids(j)).not.toContain("wise:BANK_TRANSFER");
  });
  it("drops wrong currencies, disabled options, other payout methods and bad timestamps; never invents a rate", () => {
    for (const mutate of [
      (j: ReturnType<typeof base>) => { j.paymentOptions[0].targetCurrency = "EUR"; },
      (j: ReturnType<typeof base>) => { j.paymentOptions[0].sourceCurrency = "GBP"; },
      (j: ReturnType<typeof base>) => { j.paymentOptions[0].disabled = true; },
      (j: ReturnType<typeof base>) => { j.paymentOptions[0].payOut = "SWIFT"; },
      (j: ReturnType<typeof base>) => { j.paymentOptions[0].estimatedDelivery = "soon"; },
    ]) {
      const j = base(); mutate(j);
      expect(ids(j)).not.toContain("wise:BANK_TRANSFER");
    }
    const top = base(); top.targetCurrency = "EUR";
    expect(ids(top)).toEqual([]);
    const noRate = base(); noRate.rate = 450.1234567; // 7 decimals: not a plain displayable rate
    expect(ids(noRate)).toEqual([]);
    const gone = base(); (gone as Record<string, unknown>).rate = undefined;
    expect(ids(gone)).toEqual([]);
    const expired = base(); expired.expirationTime = "nonsense";
    expect(ids(expired)).toEqual([]);
  });
  it("keeps an option whose credit is too small, so the user sees it excluded with the reason (it is judged by the policy)", () => {
    const j = base();
    j.paymentOptions[0].targetAmount = 499999.99;
    expect(parseWiseQuote(j, TUITION).find((o) => o.providerId === "wise:BANK_TRANSFER")!.providerAmounts!.targetTiyn).toBe("49999999");
  });
  it("implied rate is plain integer arithmetic", () => {
    expect(impliedRate(111038n, 50_000_000n)).toBe("450.296294");
    expect(impliedRate(100n, 45_000n)).toBe("450.000000");
  });
});

describe("the policy judges the provider's amounts", () => {
  const quote = (over: Partial<QuoteRecord> = {}): QuoteRecord => ({
    id: "q_t", providerId: "wise:BANK_TRANSFER", providerName: "Wise (pay by bank transfer)", version: 1, srcCcy: "USD", dstCcy: "KZT", rate: "450.295", feeCents: "1644",
    minKztTiyn: "1", maxKztTiyn: "999999999999999", issuedAt: "2026-10-20T11:58:26Z", expiresAt: "2026-10-20T12:28:26Z", estArrivalAt: "2026-10-23T13:28:12Z",
    eligible: true, ineligibleReason: null, provenance: "PROVIDER_LIVE", providerAmounts: { sourceTotalCents: "112682", targetTiyn: "50000000" }, ...over,
  });
  const ctxIn = { tuitionTiyn: TUITION, deadlineAt: "2026-10-27T12:00:00Z", now: "2026-10-20T12:00:00Z", usdBalanceCents: 150000n, usdReserveCents: 30000n };
  it("takes total, fee, principal and credit from the quote as given", () => {
    const e = evaluateQuote(quote(), ctxIn);
    expect(e).toMatchObject({ feasible: true, totalDebitCents: "112682", feeCents: "1644", principalCents: "111038", recipientTiyn: "50000000", surplusTiyn: "0", usdAfterCents: "37318" });
  });
  it("shows a surplus when the provider credits more than the invoice and refuses when it credits less", () => {
    expect(evaluateQuote(quote({ providerAmounts: { sourceTotalCents: "112682", targetTiyn: "50000400" } }), ctxIn)).toMatchObject({ feasible: true, surplusTiyn: "400" });
    const short = evaluateQuote(quote({ providerAmounts: { sourceTotalCents: "112682", targetTiyn: "49999999" } }), ctxIn);
    expect(short.feasible).toBe(false);
    expect(short.exclusions.map((x) => x.code)).toEqual(["INVALID_QUOTE"]);
    expect(short.exclusions[0].message).toMatch(/would not cover tuition/);
  });
  it("still enforces expiry, deadline, funds, reserve and currencies", () => {
    const codes = (q: QuoteRecord, over: Partial<typeof ctxIn> = {}) => evaluateQuote(q, { ...ctxIn, ...over }).exclusions.map((x) => x.code);
    expect(codes(quote(), { now: "2026-10-20T12:30:00Z" })).toContain("EXPIRED");
    expect(codes(quote(), { deadlineAt: "2026-10-22T00:00:00Z" })).toContain("LATE");
    expect(codes(quote(), { usdBalanceCents: 112681n, usdReserveCents: 0n })).toContain("INSUFFICIENT_FUNDS");
    expect(codes(quote(), { usdBalanceCents: 140000n })).toContain("RESERVE_BREACH"); // 140,000 - 112,682 = 27,318 < 30,000
    expect(codes(quote({ dstCcy: "EUR" }))).toContain("UNSUPPORTED_PAIR");
    expect(codes(quote(), { usdBalanceCents: 142682n })).toEqual([]); // exactly the reserve left: allowed
    expect(codes(quote(), { usdBalanceCents: 142681n })).toContain("RESERVE_BREACH"); // one cent short of the reserve
  });
  it("refuses provider quotes without exact amounts, and amounts on a non-provider quote", () => {
    expect(evaluateQuote(quote({ providerAmounts: null }), ctxIn).exclusions[0].message).toMatch(/no exact provider amounts/);
    expect(evaluateQuote(quote({ providerAmounts: { sourceTotalCents: "1644", targetTiyn: "50000000" } }), ctxIn).exclusions[0].message).toMatch(/exceed its fee/);
    expect(evaluateQuote(quote({ provenance: "USER_DECLARED", rate: "450" }), ctxIn).exclusions[0].message).toMatch(/only valid on a provider quote/);
  });
  it("leaves manual and sandbox-style quotes on the rate-based calculation", () => {
    const manual = quote({ provenance: "USER_DECLARED", providerAmounts: null, rate: "450", feeCents: "1200" });
    expect(evaluateQuote(manual, ctxIn)).toMatchObject({ feasible: true, principalCents: "111112", totalDebitCents: "112312", recipientTiyn: "50000400", surplusTiyn: "400" });
  });
});

describe("one set of amounts from the stored quote to the instruction", () => {
  async function planned(fixture: Record<string, unknown> = ROUNDING, at = AT_ROUNDING) {
    const ctx = makeLiveCtx({}, at);
    ctx.stub.wise = fixture;
    const u = readyUser(ctx);
    await refreshProviderOffers(ctx, u.userId, u.invoice.id);
    const quotes = latestQuotesForInvoice(ctx, u.userId, u.invoice.id);
    const res = evaluateRoutes({ quotes, tuitionTiyn: TUITION, deadlineAt: u.invoice.dueAt, now: at, usdBalanceCents: 150000n, usdReserveCents: 30000n, preference: "cheapest" });
    const p = prepareProposal(ctx, { ownerId: u.userId, tier: "propose", invoiceId: u.invoice.id, quoteId: res.best!.quoteId, preference: "cheapest", reserveCents: "30000" });
    return { ctx, u, p, quotes };
  }
  it("the proposal carries Wise's amounts, marks them as provider-exact, and binds them into the hash", async () => {
    const { p } = await planned();
    expect(p.payload).toMatchObject({
      providerId: "wise:BANK_TRANSFER", feeCents: "1644", principalCents: "111038", totalDebitCents: "112682", recipientTiyn: "50000000", surplusTiyn: "0",
      amountBasis: "PROVIDER_EXACT_V1", quoteProvenance: "PROVIDER_LIVE",
    });
    expect(p.hash).toBe(hashPayload(p.payload));
    // changing any bound amount (or the basis) changes the hash
    for (const patch of [{ totalDebitCents: "112683" }, { recipientTiyn: "50000001" }, { feeCents: "1645" }, { principalCents: "111039" }, { amountBasis: undefined }] as Partial<ProposalPayload>[]) {
      expect(hashPayload({ ...p.payload, ...patch } as ProposalPayload), JSON.stringify(patch)).not.toBe(p.hash);
    }
    expect(p.display.usdAfterCents).toBe("37318");
  });
  it("an approval for another hash, or for the proposal after a stored amount was altered, cannot become an instruction", async () => {
    const { ctx, u, p } = await planned();
    expect(codeOf(() => approveProposal(ctx, { ownerId: u.userId, tier: "execute", proposalId: p.id, proposalHash: "0".repeat(64) }))).toBe("APPROVAL_MISMATCH");
    approveProposal(ctx, { ownerId: u.userId, tier: "execute", proposalId: p.id, proposalHash: p.hash });
    // the stored provider total is altered after approval: the re-check recomputes from the stored quote and refuses
    ctx.db.prepare("UPDATE quotes SET provider_source_cents = '112683' WHERE id = ?").run(p.payload.quoteId);
    expect(codeOf(() => issueInstruction(ctx, { ownerId: u.userId, tier: "execute", proposalId: p.id }))).toBe("PROPOSAL_TAMPERED");
    ctx.db.prepare("UPDATE quotes SET provider_source_cents = '112682' WHERE id = ?").run(p.payload.quoteId);
    const ins = issueInstruction(ctx, { ownerId: u.userId, tier: "execute", proposalId: p.id });
    // approval -> instruction: the same numbers that were approved
    expect(ins.body).toMatchObject({ youPayUsdCents: "112682", providerFeeUsdCents: "1644", rate: "450.295", universityShouldReceiveTiyn: "50000000", executedByApp: false });
    expect(getInstruction(ctx, u.userId, ins.id).body.youPayUsdCents).toBe("112682");
  });
  it("a provider credit that no longer covers the invoice, a reserve breach and an expired quote are refused at proposal time", async () => {
    const ctx = makeLiveCtx({}, AT_ROUNDING);
    const short = JSON.parse(JSON.stringify(ROUNDING)) as { paymentOptions: { targetAmount: number }[] };
    short.paymentOptions.forEach((o) => { o.targetAmount = 499999.99; });
    ctx.stub.wise = short;
    const u = readyUser(ctx);
    await refreshProviderOffers(ctx, u.userId, u.invoice.id);
    const q = latestQuotesForInvoice(ctx, u.userId, u.invoice.id)[0];
    expect(codeOf(() => prepareProposal(ctx, { ownerId: u.userId, tier: "propose", invoiceId: u.invoice.id, quoteId: q.id, preference: "cheapest", reserveCents: "30000" }))).toBe("ROUTE_NOT_FEASIBLE");

    const rich = await planned();
    expect(codeOf(() => prepareProposal(rich.ctx, { ownerId: rich.u.userId, tier: "propose", invoiceId: rich.u.invoice.id, quoteId: rich.p.payload.quoteId, preference: "cheapest", reserveCents: "40000" }))).toBe("ROUTE_NOT_FEASIBLE"); // 1,500 - 1,126.82 = 373.18 < 400
    rich.ctx.clock.advanceMs(40 * 60_000);
    expect(codeOf(() => prepareProposal(rich.ctx, { ownerId: rich.u.userId, tier: "propose", invoiceId: rich.u.invoice.id, quoteId: rich.p.payload.quoteId, preference: "cheapest", reserveCents: "30000" }))).toBe("ROUTE_NOT_FEASIBLE");
  });
  it("the proposal view shows exactly the stored amounts (what the screens render)", async () => {
    const { ctx, u, p } = await planned();
    const v = proposalView(ctx, u.userId, p.id);
    expect(v.payload.totalDebitCents).toBe("112682");
    expect(v.payload.recipientTiyn).toBe("50000000");
    expect(v.payload.feeCents).toBe("1644");
    expect(v.display).toEqual({ usdBalanceBeforeCents: "150000", usdAfterCents: "37318" });
  });
});

describe("older databases", () => {
  it("get the two provider-amount columns, and an old provider row without them is refused rather than recomputed", () => {
    const file = join(mkdtempSync(join(tmpdir(), "tb-mig-")), "old.sqlite");
    const first = openDb(file, "live");
    first.close();
    const raw = new Database(file);
    raw.exec("ALTER TABLE quotes DROP COLUMN provider_source_cents; ALTER TABLE quotes DROP COLUMN provider_target_tiyn;");
    raw.close();
    const reopened = openDb(file, "live");
    const cols = (reopened.prepare("PRAGMA table_info(quotes)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain("provider_source_cents");
    expect(cols).toContain("provider_target_tiyn");
    reopened.close();
    // an old stored Wise quote (provider amounts NULL) is excluded by the policy
    const old: QuoteRecord = { id: "q_old", providerId: "wise:BANK_TRANSFER", providerName: "Wise", version: 1, srcCcy: "USD", dstCcy: "KZT", rate: "452.22", feeCents: "1640", minKztTiyn: "1", maxKztTiyn: "999999999999999", issuedAt: "2026-10-18T10:48:25Z", expiresAt: "2026-10-18T11:18:25Z", estArrivalAt: "2026-10-22T15:20:00Z", eligible: true, ineligibleReason: null, provenance: "PROVIDER_LIVE", providerAmounts: null };
    expect(evaluateQuote(old, { tuitionTiyn: TUITION, deadlineAt: "2026-10-27T00:00:00Z", now: "2026-10-18T10:50:00Z", usdBalanceCents: 150000n, usdReserveCents: 30000n }).feasible).toBe(false);
    void WISE_FIXTURE;
  });
});
