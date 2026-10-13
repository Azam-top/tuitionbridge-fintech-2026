import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp, COOKIE } from "../src/server/http/app.js";
import { createRunner } from "../src/server/agent/runner.js";
import { MockLlm } from "../src/server/agent/mock-llm.js";
import { hashPassword } from "../src/server/auth.js";
import { balance, count, makeCtx } from "./helpers.js";

const EN = "Pay this invoice by its deadline, use the cheapest feasible route, and keep USD 300 for living costs.";
const HOST = "127.0.0.1:8787";

function boot(env: NodeJS.ProcessEnv = {}) {
  const ctx = makeCtx("standard", env);
  const runner = createRunner(ctx, new MockLlm(), { retryDelayMs: 1 });
  const app = buildApp({ ctx, runner, llm: new MockLlm(), webDir: "/nonexistent" });
  return { ctx, runner, app };
}

interface Client { cookie: string; csrf: string }
async function signIn(app: FastifyInstance, email = "alice@demo.local", password = "demo-alice-2026"): Promise<Client> {
  const r = await app.inject({ method: "POST", url: "/api/auth/login", headers: { host: HOST, origin: `http://${HOST}` }, payload: { email, password } });
  expect(r.statusCode).toBe(200);
  const set = r.cookies.find((c) => c.name === COOKIE)!;
  expect(set.httpOnly).toBe(true);
  expect(String(set.sameSite).toLowerCase()).toBe("strict");
  return { cookie: `${COOKIE}=${set.value}`, csrf: (r.json() as { csrfToken: string }).csrfToken };
}
const call = (app: FastifyInstance, c: Client | null, method: "GET" | "POST" | "PATCH", url: string, payload?: unknown, extra: Record<string, string> = {}) =>
  app.inject({
    method, url, payload: payload as object | undefined,
    headers: { host: HOST, ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}), ...(method !== "GET" ? { origin: `http://${HOST}` } : {}), ...extra },
  });

async function startTask(app: FastifyInstance, runner: ReturnType<typeof boot>["runner"], c: Client, instruction = EN) {
  const st = (await call(app, c, "GET", "/api/state")).json() as { invoices: { id: string }[] };
  const invoiceId = st.invoices[0].id;
  expect((await call(app, c, "POST", `/api/invoices/${invoiceId}/confirm`)).json()).toMatchObject({ status: "CONFIRMED" });
  const r = await call(app, c, "POST", "/api/tasks", { invoiceId, instruction });
  expect(r.statusCode).toBe(202);
  const id = (r.json() as { task: { id: string } }).task.id;
  await runner.settled(id);
  return { invoiceId, taskId: id };
}

describe("authentication and request integrity", () => {
  it("requires a session; rejects bad credentials; sets hardened cookies", async () => {
    const { app } = boot();
    expect((await call(app, null, "GET", "/api/state")).statusCode).toBe(401);
    const bad = await app.inject({ method: "POST", url: "/api/auth/login", headers: { host: HOST, origin: `http://${HOST}` }, payload: { email: "alice@demo.local", password: "nope" } });
    expect(bad.statusCode).toBe(401);
    await signIn(app);
  });
  it("rejects mutations without the CSRF token, and with a foreign Origin", async () => {
    const { app } = boot();
    const c = await signIn(app);
    const noCsrf = await app.inject({ method: "POST", url: "/api/demo/reset", payload: {}, headers: { host: HOST, origin: `http://${HOST}`, cookie: c.cookie } });
    expect(noCsrf.statusCode).toBe(403);
    const wrongCsrf = await call(app, { ...c, csrf: "x".repeat(40) }, "POST", "/api/demo/reset", {});
    expect(wrongCsrf.statusCode).toBe(403);
    const foreign = await call(app, c, "POST", "/api/demo/reset", {}, { origin: "http://evil.example" });
    expect(foreign.statusCode).toBe(403);
    expect((await call(app, c, "POST", "/api/demo/reset", {})).statusCode).toBe(200);
  });
  it("does not enable CORS and sends security headers", async () => {
    const { app } = boot();
    const r = await call(app, null, "GET", "/api/config", undefined, { origin: "http://evil.example" });
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
    expect(r.headers["x-frame-options"]).toBe("DENY");
    expect(String(r.headers["content-security-policy"])).toContain("default-src 'self'");
  });
  it("rate-limits repeated sign-in attempts", async () => {
    const { app } = boot();
    let last = 0;
    for (let i = 0; i < 12; i++) {
      last = (await app.inject({ method: "POST", url: "/api/auth/login", headers: { host: HOST, origin: `http://${HOST}` }, payload: { email: "alice@demo.local", password: "wrong" } })).statusCode;
    }
    expect(last).toBe(429);
  });
  it("rejects oversize bodies and unknown fields", async () => {
    const { app } = boot();
    const c = await signIn(app);
    const big = await call(app, c, "POST", "/api/invoices", { reference: "x".repeat(70 * 1024) });
    expect(big.statusCode).toBe(413);
    const unknown = await call(app, c, "POST", "/api/tasks", { invoiceId: "inv", instruction: "pay", userId: "usr_bob" });
    expect(unknown.statusCode).toBe(400);
  });
});

describe("full flow over HTTP", () => {
  it("login -> confirm -> task -> approve -> receipt, with real ledger effects", async () => {
    const { app, runner, ctx } = boot();
    const c = await signIn(app);
    const { taskId } = await startTask(app, runner, c);
    const view = (await call(app, c, "GET", `/api/tasks/${taskId}`)).json() as { task: { state: string; mode: string }; proposal: { hash: string; id: string; payload: { totalDebitCents: string } }; events: { tool: string }[] };
    expect(view.task.state).toBe("AWAITING_APPROVAL");
    expect(view.task.mode).toBe("MOCK");
    expect(view.proposal.payload.totalDebitCents).toBe("101000");
    expect(balance(ctx, "usr_alice", "USD")).toBe(150_000n);
    const ap = await call(app, c, "POST", `/api/tasks/${taskId}/approve`, { proposalHash: view.proposal.hash });
    expect(ap.statusCode).toBe(200);
    await runner.settled(taskId);
    const done = (await call(app, c, "GET", `/api/tasks/${taskId}`)).json() as { task: { state: string; paymentId: string }; receipt: { simulated: boolean; usdBalanceAfterCents: string } };
    expect(done.task.state).toBe("COMPLETED");
    expect(done.receipt).toMatchObject({ simulated: true, usdBalanceAfterCents: "49000" });
    expect(balance(ctx, "usr_alice", "USD")).toBe(49_000n);
    const st = (await call(app, c, "GET", "/api/state")).json() as { balances: { usd: { balanceCents: string } }; invoices: { status: string }[] };
    expect(st.balances.usd.balanceCents).toBe("49000");
    expect(st.invoices[0].status).toBe("PAID");
  });
  it("an approval with the wrong hash is rejected and nothing is paid", async () => {
    const { app, runner, ctx } = boot();
    const c = await signIn(app);
    const { taskId } = await startTask(app, runner, c);
    const r = await call(app, c, "POST", `/api/tasks/${taskId}/approve`, { proposalHash: "a".repeat(64) });
    expect(r.statusCode).toBe(422);
    expect(count(ctx, "payments")).toBe(0);
  });
  it("direct execute endpoint refuses a forged approval id and text-only approval", async () => {
    const { app, runner, ctx } = boot();
    const c = await signIn(app);
    const { taskId } = await startTask(app, runner, c);
    const view = (await call(app, c, "GET", `/api/tasks/${taskId}`)).json() as { proposal: { id: string } };
    for (const approvalId of ["apr_forged", "approved", "yes-i-approve"]) {
      const r = await call(app, c, "POST", "/api/payments/execute", { proposalId: view.proposal.id, approvalId, idempotencyKey: "key-http-0001" });
      expect(r.statusCode).toBe(422);
      expect((r.json() as { error: { code: string } }).error.code).toBe("APPROVAL_MISSING");
    }
    expect(count(ctx, "payments")).toBe(0);
    expect(balance(ctx, "usr_alice", "USD")).toBe(150_000n);
  });
});

describe("ownership and tiers over HTTP (critical)", () => {
  it("Bob cannot read, approve, cancel or pay Alice's task, proposal, payment or invoice", async () => {
    const { app, runner, ctx } = boot();
    const a = await signIn(app);
    const { taskId, invoiceId } = await startTask(app, runner, a);
    const view = (await call(app, a, "GET", `/api/tasks/${taskId}`)).json() as { proposal: { id: string; hash: string } };
    const b = await signIn(app, "bob@demo.local", "demo-bob-2026");
    expect((await call(app, b, "GET", `/api/tasks/${taskId}`)).statusCode).toBe(404);
    expect((await call(app, b, "POST", `/api/tasks/${taskId}/approve`, { proposalHash: view.proposal.hash })).statusCode).toBe(404);
    expect((await call(app, b, "POST", `/api/proposals/${view.proposal.id}/approve`, { proposalHash: view.proposal.hash })).statusCode).toBe(404);
    expect((await call(app, b, "POST", `/api/tasks/${taskId}/cancel`)).statusCode).toBe(404);
    expect((await call(app, b, "POST", `/api/invoices/${invoiceId}/confirm`)).statusCode).toBe(404);
    expect((await call(app, b, "PATCH", `/api/invoices/${invoiceId}`, { amountKztTiyn: "1000000" })).statusCode).toBe(404);
    expect((await call(app, b, "POST", "/api/payments/execute", { proposalId: view.proposal.id, approvalId: "apr_x", idempotencyKey: "key-bob-0001" })).statusCode).toBe(404);
    const bobState = (await call(app, b, "GET", "/api/state")).json() as { invoices: { id: string }[]; latestTask: unknown };
    expect(bobState.invoices.map((i) => i.id)).not.toContain(invoiceId);
    expect(bobState.latestTask).toBeNull();
    expect(count(ctx, "payments")).toBe(0);
  });
  it("client-supplied user ids and amounts are ignored/rejected", async () => {
    const { app } = boot();
    const a = await signIn(app);
    const r = await call(app, a, "POST", "/api/tasks", { invoiceId: "inv_x", instruction: EN, ownerUserId: "usr_bob" });
    expect(r.statusCode).toBe(400);
  });
  it("a read-only account can look but not propose, approve or execute", async () => {
    const { app, ctx } = boot();
    ctx.db.prepare("INSERT INTO users (id, email, display_name, password_hash, max_tier, scenario) VALUES ('usr_ro','ro@demo.local','Read Only',?, 'read','standard')").run(hashPassword("ro-password-1"));
    ctx.db.prepare("INSERT INTO ledger_accounts (id, owner_user_id, kind, currency, balance_minor, reserve_minor) VALUES ('acc_ro_usd','usr_ro','user','USD','100000','0')").run();
    ctx.db.prepare("INSERT INTO ledger_accounts (id, owner_user_id, kind, currency, balance_minor, reserve_minor) VALUES ('acc_ro_kzt','usr_ro','user','KZT','0','0')").run();
    const c = await signIn(app, "ro@demo.local", "ro-password-1");
    expect((await call(app, c, "GET", "/api/state")).statusCode).toBe(200);
    expect((await call(app, c, "POST", "/api/tasks", { invoiceId: "inv_x", instruction: EN })).statusCode).toBe(403);
    expect((await call(app, c, "POST", "/api/payments/execute", { proposalId: "p", approvalId: "a", idempotencyKey: "key-ro-00001" })).statusCode).toBe(403);
    expect((await call(app, c, "POST", "/api/invoices", {})).statusCode).toBe(403);
  });
  it("demo reset is blocked outside demo mode", async () => {
    const { app } = boot({ APP_DEMO_MODE: "0" });
    const c = await signIn(app);
    expect((await call(app, c, "POST", "/api/demo/reset", {})).statusCode).toBe(403);
    expect(((await call(app, null, "GET", "/api/config")).json() as { demoMode: boolean }).demoMode).toBe(false);
  });
  it("demo reset restores a clean dataset and applies the chosen scenario", async () => {
    const { app, runner, ctx } = boot();
    const c = await signIn(app);
    const { taskId } = await startTask(app, runner, c);
    const hash = ((await call(app, c, "GET", `/api/tasks/${taskId}`)).json() as { proposal: { hash: string } }).proposal.hash;
    await call(app, c, "POST", `/api/tasks/${taskId}/approve`, { proposalHash: hash });
    await runner.settled(taskId);
    expect(count(ctx, "payments")).toBe(1);
    expect((await call(app, c, "POST", "/api/demo/reset", { scenario: "insufficient" })).statusCode).toBe(200);
    expect(count(ctx, "payments")).toBe(0);
    const st = (await call(app, c, "GET", "/api/state")).json() as { balances: { usd: { balanceCents: string } }; invoices: { status: string }[] };
    expect(st.balances.usd.balanceCents).toBe("90000");
    expect(st.invoices[0].status).toBe("DRAFT");
  });
  it("exposes honest mode flags", async () => {
    const { app } = boot();
    const cfg = (await call(app, null, "GET", "/api/config")).json() as { agentMode: string; payments: string; replay: boolean; liveVerifiedInThisDatabase: boolean };
    expect(cfg).toMatchObject({ agentMode: "MOCK", payments: "SIMULATED", replay: false, liveVerifiedInThisDatabase: false });
  });
});

describe("invoice import over HTTP", () => {
  const GOOD = ["Invoice No: INV-2026-0901", "Registry ID: UNI-ALM-001", "Beneficiary: Alatau Meridian University", "Account: KZ00SANDBOX0000000001", "Amount due: KZT 120,000.00", "Due date: 2026-10-14 09:48 +05:00"];
  it("imports text and a text PDF as unconfirmed drafts; rejects junk", async () => {
    const { app } = boot();
    const c = await signIn(app);
    const t = await call(app, c, "POST", "/api/invoices/import", { text: GOOD.join("\n") });
    expect(t.statusCode).toBe(201);
    expect(t.json()).toMatchObject({ status: "DRAFT", reference: "INV-2026-0901", amountKztTiyn: "12000000", sourceType: "structured" });
    const { makeTextPdf } = await import("./pdf-helper.js");
    const pdf = Buffer.from(makeTextPdf(GOOD.map((l) => l.replace("0901", "0902")))).toString("base64");
    const p = await call(app, c, "POST", "/api/invoices/import", { pdfBase64: pdf });
    expect(p.statusCode).toBe(201);
    expect(p.json()).toMatchObject({ status: "DRAFT", reference: "INV-2026-0902", sourceType: "text_pdf" });
    expect((await call(app, c, "POST", "/api/invoices/import", { pdfBase64: Buffer.from("not a pdf").toString("base64") })).statusCode).toBe(400);
    expect((await call(app, c, "POST", "/api/invoices/import", { text: "a", pdfBase64: pdf })).statusCode).toBe(400);
    expect((await call(app, c, "POST", "/api/invoices/import", {})).statusCode).toBe(400);
    expect((await call(app, null, "POST", "/api/invoices/import", { text: "x" })).statusCode).toBe(401);
  });
  it("another user cannot see imported invoices", async () => {
    const { app } = boot();
    const a = await signIn(app);
    const inv = (await call(app, a, "POST", "/api/invoices/import", { text: GOOD.join("\n") })).json() as { id: string };
    const b = await signIn(app, "bob@demo.local", "demo-bob-2026");
    expect((await call(app, b, "POST", `/api/invoices/${inv.id}/confirm`)).statusCode).toBe(404);
  });
});
