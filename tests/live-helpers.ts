// Helpers for the LIVE-mode tests. Inputs here are clearly labeled test inputs: the Wise and NBK bodies are real responses
// recorded on 2026-10-18 (tests/fixtures/*.recorded-*), served by a stub so no test touches the network.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/server/db.js";
import { loadConfig } from "../src/server/config.js";
import { TestClock } from "../src/server/clock.js";
import type { Ctx } from "../src/server/ctx.js";
import { registerUser, declareFunds } from "../src/server/services/accounts.js";
import { attestRecipient } from "../src/server/services/recipients.js";
import { confirmInvoice, createInvoice } from "../src/server/services/invoices.js";

export const WISE_FIXTURE = JSON.parse(readFileSync("tests/fixtures/wise-quote-usd-kzt.recorded-2026-10-18.json", "utf8")) as Record<string, unknown>;
export const NBK_FIXTURE = readFileSync("tests/fixtures/nbk-rates.recorded-2026-10-18.xml", "utf8");
/** A moment inside the recorded Wise quote's validity window (created 10:48:25Z, expires 11:18:25Z). */
export const NOW_IN_WISE_WINDOW = "2026-10-18T10:50:00.000Z";

export function makeIban(bban = "125KZT0000000001", cc = "KZ"): string {
  const digits = (bban + cc + "00").split("").map((c) => (c >= "A" ? String(c.charCodeAt(0) - 55) : c)).join("");
  let rem = 0;
  for (const ch of digits) rem = (rem * 10 + Number(ch)) % 97;
  return `${cc}${String(98 - rem).padStart(2, "0")}${bban}`;
}
export const IBAN = makeIban();

export interface StubState { wise: unknown; wiseFail: boolean; nbk: string; nbkFail: boolean; calls: { url: string; method: string; body: string | null }[] }

export function makeLiveCtx(env: NodeJS.ProcessEnv = {}, nowIso = NOW_IN_WISE_WINDOW): Ctx & { clock: TestClock; stub: StubState } {
  const stub: StubState = { wise: WISE_FIXTURE, wiseFail: false, nbk: NBK_FIXTURE, nbkFail: false, calls: [] };
  const fetchStub = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    stub.calls.push({ url: u, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : null });
    if (u.includes("wise.com")) {
      if (stub.wiseFail) throw new Error("network down");
      return new Response(JSON.stringify(stub.wise), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (u.includes("nationalbank.kz")) {
      if (stub.nbkFail) throw new Error("network down");
      return new Response(stub.nbk, { status: 200, headers: { "content-type": "text/xml" } });
    }
    throw new Error(`unexpected URL in test: ${u}`);
  }) as typeof fetch;
  const clock = new TestClock(Date.parse(nowIso));
  const config = loadConfig({
    APP_MODE: "live", APP_LLM_API_KEY: "test-key-not-real", APP_LLM_MODEL: "test-model", APP_WISE_QUOTES: "1",
    APP_UPLOAD_DIR: mkdtempSync(join(tmpdir(), "tb-uploads-")), APP_APPROVAL_TTL_MS: "600000", ...env,
  });
  return { db: openDb(":memory:", "live"), clock, config, http: { fetch: fetchStub }, stub };
}

/** Registers a user with funds, an attested recipient and a CONFIRMED invoice due a week out. */
export function readyUser(ctx: Ctx, opts: { email?: string; balance?: string; reserve?: string; amountTiyn?: string; reference?: string } = {}) {
  const { userId } = registerUser(ctx, { email: opts.email ?? "student@example.org", displayName: "Test Student", password: "a-long-test-password" });
  declareFunds(ctx, userId, { usdBalance: opts.balance ?? "1500", usdReserve: opts.reserve ?? "300" });
  const rec = attestRecipient(ctx, userId, { name: "Test University", account: IBAN, sourceUrl: "https://example.edu/payments", sourceNote: "Official payment page, captured 2026-10-18" });
  const due = new Date(ctx.clock.now().getTime() + 7 * 86_400_000).toISOString();
  const inv = createInvoice(ctx, userId, {
    reference: opts.reference ?? "INV-TEST-1", recipientRegistryId: "", beneficiaryName: "Test University", beneficiaryAccount: IBAN,
    amountKztTiyn: opts.amountTiyn ?? "50000000", dueAt: due, sourceType: "manual",
  });
  const confirmed = confirmInvoice(ctx, userId, inv.id);
  return { userId, recipient: rec, invoice: confirmed };
}
