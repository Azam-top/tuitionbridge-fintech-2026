import { describe, expect, it } from "vitest";
import { parseRate, senderPrincipalCents, recipientTiyn, formatUsd, formatKzt, parseMinor } from "../src/shared/money.js";
import { evaluateRoutes, type QuoteRecord } from "../src/shared/policy.js";
import { canonicalJson } from "../src/shared/canonical.js";
import { parseInstruction } from "../src/shared/intent.js";

const NOW = "2026-10-12T10:00:00.000Z";
const at = (h: number) => new Date(Date.parse(NOW) + h * 3600_000).toISOString();

function quote(id: string, rate: string, feeCents: string, arrivalH: number, over: Partial<QuoteRecord> = {}): QuoteRecord {
  return {
    id, providerId: id, providerName: `Provider ${id}`, version: 1, srcCcy: "USD", dstCcy: "KZT",
    rate, feeCents, minKztTiyn: "1000000", maxKztTiyn: "500000000", issuedAt: NOW, expiresAt: at(0.25),
    estArrivalAt: at(arrivalH), eligible: true, ineligibleReason: null, provenance: "SIMULATED", ...over,
  };
}

const base = {
  tuitionTiyn: 50_000_000n, deadlineAt: at(48), now: NOW,
  usdBalanceCents: 150_000n, usdReserveCents: 30_000n,
};
const A = () => quote("A", "495", "1500", 6);
const B = () => quote("B", "505", "500", 72);
const C = () => quote("C", "500", "1000", 24);

describe("exact money math", () => {
  it("rounds the sender principal up and recipient amount down", () => {
    const r = parseRate("495");
    const p = senderPrincipalCents(50_000_000n, r);
    expect(p).toBe(101_011n);
    expect(recipientTiyn(p, r)).toBe(50_000_445n);
    expect(recipientTiyn(p - 1n, r)).toBeLessThan(50_000_000n); // one cent less would not cover tuition
  });
  it("handles decimal rates exactly", () => {
    const r = parseRate("498.37");
    const p = senderPrincipalCents(123_456_789n, r);
    expect(p).toBe(247_722n);
    expect(recipientTiyn(p, r)).toBeGreaterThanOrEqual(123_456_789n);
    expect(recipientTiyn(p - 1n, r)).toBeLessThan(123_456_789n);
  });
  it("rejects invalid inputs", () => {
    expect(() => parseRate("0")).toThrow();
    expect(() => parseRate("-5")).toThrow();
    expect(() => parseRate("1e3")).toThrow();
    expect(() => parseMinor("-1")).toThrow();
    expect(() => parseMinor("1.5")).toThrow();
    expect(() => parseMinor("12abc")).toThrow();
  });
  it("formats with units", () => {
    expect(formatUsd(101_000n)).toBe("USD 1,010.00");
    expect(formatKzt("50000000")).toBe("KZT 500,000.00");
  });
});

describe("reference fixture", () => {
  const res = evaluateRoutes({ ...base, quotes: [A(), B(), C()], preference: "cheapest" });
  const by = (id: string) => res.routes.find((r) => r.quoteId === id)!;
  it("matches the independently computed totals", () => {
    expect(by("C").totalDebitCents).toBe("101000");
    expect(by("C").usdAfterCents).toBe("49000");
    expect(by("A").totalDebitCents).toBe("102511");
    expect(by("B").totalDebitCents).toBe("99510");
    expect(by("A").surplusTiyn).toBe("445");
    expect(by("C").surplusTiyn).toBe("0");
  });
  it("excludes the late cheap route and selects C when cheapest", () => {
    expect(by("B").feasible).toBe(false);
    expect(by("B").exclusions.map((e) => e.code)).toContain("LATE");
    expect(res.best?.quoteId).toBe("C");
  });
  it("selects A when faster is preferred", () => {
    const fast = evaluateRoutes({ ...base, quotes: [A(), B(), C()], preference: "fastest" });
    expect(fast.best?.quoteId).toBe("A");
  });
  it("returns no best route when nothing arrives on time", () => {
    const late = evaluateRoutes({ ...base, quotes: [quote("A", "495", "1500", 60), B(), quote("C", "500", "1000", 49)], preference: "cheapest" });
    expect(late.best).toBeNull();
  });
});

describe("eligibility", () => {
  it("excludes expired, ineligible, unsupported and out-of-range quotes", () => {
    const res = evaluateRoutes({
      ...base, preference: "cheapest",
      quotes: [
        quote("E", "500", "1000", 24, { expiresAt: NOW }),
        quote("N", "500", "1000", 24, { eligible: false, ineligibleReason: "Corridor paused" }),
        quote("U", "500", "1000", 24, { dstCcy: "UZS" }),
        quote("R", "500", "1000", 24, { maxKztTiyn: "1000" }),
      ],
    });
    expect(res.best).toBeNull();
    const codes = Object.fromEntries(res.routes.map((r) => [r.quoteId, r.exclusions.map((e) => e.code)]));
    expect(codes.E).toContain("EXPIRED");
    expect(codes.N).toContain("NOT_ELIGIBLE");
    expect(codes.U).toContain("UNSUPPORTED_PAIR");
    expect(codes.R).toContain("AMOUNT_OUT_OF_RANGE");
  });
  it("flags invalid quotes instead of throwing", () => {
    const res = evaluateRoutes({ ...base, preference: "cheapest", quotes: [quote("X", "-3", "1000", 24)] });
    expect(res.routes[0].exclusions.map((e) => e.code)).toContain("INVALID_QUOTE");
  });
});

describe("funds and reserve", () => {
  it("preserves the reserve exactly at the boundary and excludes one cent below", () => {
    // C total debit is 101000; balance 131000 leaves exactly 30000 (allowed)
    const ok = evaluateRoutes({ ...base, usdBalanceCents: 131_000n, quotes: [C()], preference: "cheapest" });
    expect(ok.best?.quoteId).toBe("C");
    const bad = evaluateRoutes({ ...base, usdBalanceCents: 130_999n, quotes: [C()], preference: "cheapest" });
    expect(bad.best).toBeNull();
    expect(bad.routes[0].exclusions.map((e) => e.code)).toContain("RESERVE_BREACH");
  });
  it("distinguishes insufficient funds from reserve breach", () => {
    const res = evaluateRoutes({ ...base, usdBalanceCents: 90_000n, quotes: [C()], preference: "cheapest" });
    expect(res.routes[0].exclusions.map((e) => e.code)).toContain("INSUFFICIENT_FUNDS");
  });
});

describe("deterministic tie-breaking", () => {
  it("breaks ties by the secondary key, then fee, then quote id", () => {
    const x = quote("X", "500", "1000", 24);
    const y = quote("Y", "500", "1000", 24);
    expect(evaluateRoutes({ ...base, quotes: [y, x], preference: "cheapest" }).best?.quoteId).toBe("X");
    expect(evaluateRoutes({ ...base, quotes: [x, y], preference: "fastest" }).best?.quoteId).toBe("X");
    // same debit, different arrival: cheapest picks earlier arrival
    const early = quote("Z", "500", "1000", 12);
    expect(evaluateRoutes({ ...base, quotes: [x, early], preference: "cheapest" }).best?.quoteId).toBe("Z");
  });
});

describe("canonical JSON", () => {
  it("is key-order independent and rejects floats and BigInt", () => {
    expect(canonicalJson({ b: "1", a: { d: 2, c: [1, "x"] } })).toBe('{"a":{"c":[1,"x"],"d":2},"b":"1"}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
    expect(() => canonicalJson({ a: 1.5 })).toThrow();
    expect(() => canonicalJson({ a: 10n })).toThrow();
  });
});

describe("instruction parsing", () => {
  it("parses the English example", () => {
    const p = parseInstruction("Pay this invoice by its deadline, use the cheapest feasible route, and keep USD 300 for living costs.");
    expect(p).toMatchObject({ preference: "cheapest", reserveCents: "30000", language: "en" });
  });
  it("parses a faster preference", () => {
    expect(parseInstruction("Pay the invoice, prefer faster arrival, keep $450.50 reserve").preference).toBe("fastest");
    expect(parseInstruction("keep $450.50 reserve").reserveCents).toBe("45050");
  });
  it("parses an equivalent Russian instruction", () => {
    const p = parseInstruction("Оплати счёт до срока, выбери самый дешёвый вариант и оставь 300 долларов на жизнь.");
    expect(p).toMatchObject({ preference: "cheapest", reserveCents: "30000", language: "ru" });
  });
  it("surfaces conflicting preferences instead of guessing", () => {
    const p = parseInstruction("cheapest but also the fastest");
    expect(p.preference).toBeNull();
    expect(p.ambiguous.length).toBe(1);
  });
});
