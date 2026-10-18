import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { Ctx } from "../ctx.js";
import { agentMode } from "../config.js";
import { login, logout, sessionUser, SESSION_TTL_MS, tierAllows, type SessionUser, type Tier } from "../auth.js";
import { PolicyError, type ErrorCode } from "../errors.js";
import { RateLimiter } from "./rate-limit.js";
import { confirmInvoice, createInvoice, listInvoices, parseInput, updateInvoice } from "../services/invoices.js";
import { extractPdfText, importInvoiceFromText } from "../services/invoice-import.js";
import { getBalances } from "../services/ledger.js";
import { executePayment } from "../services/execution.js";
import { proposalView, approveProposal } from "../services/proposals.js";
import { resetDemo } from "../services/seed.js";
import { SCENARIOS, FIXTURES_VERSION, type ScenarioId } from "../fixtures.js";
import { getTask, type Runner, type TaskRow } from "../agent/runner.js";
import type { LlmClient } from "../agent/types.js";
import { audit } from "../services/audit.js";

const STATUS: Partial<Record<ErrorCode, number>> = {
  NOT_FOUND: 404, FORBIDDEN_TIER: 403, VALIDATION: 400, INTENT_CONFLICT: 400, RESERVE_LOWERING: 400, DEMO_ONLY: 403,
  TASK_ACTIVE: 409, TASK_STATE: 409, DUPLICATE_PAYMENT: 409, IDEMPOTENCY_CONFLICT: 409, APPROVAL_CONSUMED: 409, PROPOSAL_NOT_PENDING: 409,
  INVOICE_ALREADY_PAID: 409, PROVIDER_FAILURE: 502,
};

export const COOKIE = "tb_session";

declare module "fastify" {
  interface FastifyRequest { user?: SessionUser }
}

export interface AppDeps {
  ctx: Ctx;
  runner: Runner;
  llm: LlmClient;
  webDir?: string;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const { ctx, runner, llm } = deps;
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024, trustProxy: false });
  app.register(fastifyCookie);
  const loginLimiter = new RateLimiter(ctx.config.loginRateLimitPerMinute, 60_000);
  const mutateLimiter = new RateLimiter(ctx.config.mutateRateLimitPerMinute, 60_000);
  const taskLimiter = new RateLimiter(ctx.config.taskRateLimitPerMinute, 60_000);

  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Cache-Control", "no-store");
    reply.header("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    return payload;
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof PolicyError) {
      return reply.code(STATUS[err.code] ?? 422).send({ error: { code: err.code, message: err.message, details: err.details ?? null } });
    }
    const e = err as { statusCode?: number };
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: { code: "BAD_REQUEST", message: "Malformed request." } });
    // Never leak stack traces, SQL or payloads.
    return reply.code(500).send({ error: { code: "INTERNAL", message: "Unexpected server error." } });
  });

  const isMutation = (m: string) => m !== "GET" && m !== "HEAD" && m !== "OPTIONS";

  // Same-origin check for every mutation (CORS is not enabled at all).
  app.addHook("preHandler", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
    if (!isMutation(req.method)) return;
    const origin = req.headers.origin;
    if (origin) {
      let ok = false;
      try { ok = new URL(origin).host === req.headers.host; } catch { ok = false; }
      if (!ok) return reply.code(403).send({ error: { code: "BAD_ORIGIN", message: "Cross-origin request rejected." } });
    }
  });

  function auth(req: FastifyRequest, needed: Tier = "read"): SessionUser {
    const u = sessionUser(ctx.db, ctx.clock, req.cookies[COOKIE]);
    if (!u) throw new PolicyError("NOT_FOUND", "Not signed in.", { unauthenticated: true });
    if (isMutation(req.method)) {
      const hdr = req.headers["x-csrf-token"];
      if (typeof hdr !== "string" || hdr !== u.csrfToken) throw new PolicyError("VALIDATION", "Missing or invalid CSRF token.", { csrf: true });
      if (!mutateLimiter.allow(`u:${u.userId}`)) throw new PolicyError("VALIDATION", "Too many requests. Slow down.", { rateLimited: true });
    }
    // Effective tier for a human session = the account's maximum tier, checked per endpoint.
    if (!tierAllows(u.maxTier, needed)) throw new PolicyError("FORBIDDEN_TIER", `This action requires the ${needed} tier.`);
    return u;
  }
  const guard = (needed: Tier, h: (req: FastifyRequest, reply: FastifyReply, u: SessionUser) => unknown | Promise<unknown>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      try { return await h(req, reply, auth(req, needed)); }
      catch (e) {
        if (e instanceof PolicyError && e.details?.unauthenticated) return reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "Please sign in." } });
        if (e instanceof PolicyError && (e.details?.csrf)) return reply.code(403).send({ error: { code: "CSRF", message: e.message } });
        if (e instanceof PolicyError && e.details?.rateLimited) return reply.code(429).send({ error: { code: "RATE_LIMITED", message: e.message } });
        throw e;
      }
    };

  const publicConfig = () => {
    const liveEvidence = (ctx.db.prepare("SELECT COUNT(*) c FROM agent_tasks WHERE mode='LIVE' AND usage_known=1").get() as { c: number }).c;
    return {
      agentMode: agentMode(ctx.config),
      liveVerifiedInThisDatabase: liveEvidence > 0,
      payments: "SIMULATED" as const,
      replay: false,
      demoMode: ctx.config.demoMode,
      scenarios: ctx.config.demoMode ? SCENARIOS : [],
      fixturesVersion: FIXTURES_VERSION,
      limits: { maxToolCalls: ctx.config.maxToolCalls, maxModelRequests: ctx.config.maxModelRequests, maxTransientRetries: ctx.config.maxTransientRetries, approvalMinutes: Math.round(ctx.config.approvalTtlMs / 60000) },
    };
  };

  app.get("/api/config", async () => publicConfig());

  // ---- auth ----
  app.post("/api/auth/login", async (req, reply) => {
    if (!loginLimiter.allow(`ip:${req.ip}`)) return reply.code(429).send({ error: { code: "RATE_LIMITED", message: "Too many sign-in attempts. Wait a minute." } });
    const body = parseInput(z.object({ email: z.string().max(200), password: z.string().max(200) }).strict(), req.body);
    const r = login(ctx.db, ctx.clock, body.email, body.password);
    if (!r) {
      audit(ctx.db, ctx.clock, { ownerUserId: null, event: "auth.login", result: "REJECTED" });
      return reply.code(401).send({ error: { code: "BAD_CREDENTIALS", message: "Email or password is incorrect." } });
    }
    reply.setCookie(COOKIE, r.token, { httpOnly: true, sameSite: "strict", path: "/", secure: ctx.config.cookieSecure, maxAge: Math.floor(SESSION_TTL_MS / 1000) });
    audit(ctx.db, ctx.clock, { ownerUserId: r.user.userId, event: "auth.login", result: "ALLOWED" });
    return { user: { email: r.user.email, displayName: r.user.displayName, maxTier: r.user.maxTier }, csrfToken: r.user.csrfToken };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    logout(ctx.db, req.cookies[COOKIE]);
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/me", guard("read", (_r, _p, u) => ({ user: { email: u.email, displayName: u.displayName, maxTier: u.maxTier }, csrfToken: u.csrfToken })));

  // ---- state ----
  const taskSummary = (t: TaskRow) => ({
    id: t.id, state: t.state, mode: t.mode, model: t.model, invoiceId: t.invoice_id, createdAt: t.created_at,
    proposalId: t.proposal_id, paymentId: t.payment_id, summary: t.summary, error: t.error,
  });
  app.get("/api/state", guard("read", (_req, _reply, u) => {
    const tasks = ctx.db.prepare("SELECT * FROM agent_tasks WHERE owner_user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").all(u.userId) as TaskRow[];
    return {
      user: { email: u.email, displayName: u.displayName, maxTier: u.maxTier },
      config: publicConfig(), balances: getBalances(ctx, u.userId), invoices: listInvoices(ctx, u.userId),
      latestTask: tasks[0] ? taskSummary(runner.refresh(u.userId, tasks[0].id)) : null,
      now: ctx.clock.now().toISOString(),
    };
  }));

  // ---- invoices ----
  app.post("/api/invoices", guard("propose", (req, reply, u) => { reply.code(201); return createInvoice(ctx, u.userId, req.body); }));
  app.post("/api/invoices/import", { bodyLimit: 512 * 1024 }, guard("propose", async (req, reply, u) => {
    const b = parseInput(z.object({ text: z.string().max(20_000).optional(), pdfBase64: z.string().max(420_000).optional() }).strict().refine((v) => !!v.text !== !!v.pdfBase64, "Send exactly one of text or pdfBase64."), req.body);
    reply.code(201);
    if (b.pdfBase64) {
      if (!/^[A-Za-z0-9+/=]+$/.test(b.pdfBase64)) throw new PolicyError("VALIDATION", "pdfBase64 is not valid base64.");
      const text = await extractPdfText(new Uint8Array(Buffer.from(b.pdfBase64, "base64")));
      return importInvoiceFromText(ctx, u.userId, text, "text_pdf");
    }
    return importInvoiceFromText(ctx, u.userId, b.text!, "structured");
  }));
  app.patch("/api/invoices/:id", guard("propose", (req, _r, u) => updateInvoice(ctx, u.userId, (req.params as { id: string }).id, req.body)));
  app.post("/api/invoices/:id/confirm", guard("propose", (req, _r, u) => confirmInvoice(ctx, u.userId, (req.params as { id: string }).id)));

  // ---- tasks ----
  function taskView(userId: string, id: string) {
    const t = runner.refresh(userId, id);
    const events = (ctx.db.prepare("SELECT seq, kind, tool, ok, input_json, output_json, text, created_at FROM agent_events WHERE task_id = ? ORDER BY seq").all(id) as {
      seq: number; kind: string; tool: string | null; ok: number | null; input_json: string | null; output_json: string | null; text: string | null; created_at: string;
    }[]).map((e) => ({
      seq: e.seq, kind: e.kind, tool: e.tool, ok: e.ok === null ? null : e.ok === 1, text: e.text, at: e.created_at,
      input: e.input_json ? safeJson(e.input_json) : null, output: e.output_json ? safeJson(e.output_json) : null,
    }));
    const proposal = t.proposal_id ? proposalView(ctx, userId, t.proposal_id) : null;
    const pay = t.payment_id ? (ctx.db.prepare("SELECT receipt_json FROM payments WHERE id = ? AND owner_user_id = ?").get(t.payment_id, userId) as { receipt_json: string } | undefined) : undefined;
    return {
      task: {
        ...taskSummary(t), instruction: t.instruction, intent: JSON.parse(t.intent_json) as unknown,
        usage: { toolCalls: t.tool_calls, modelRequests: t.model_requests, retries: t.retries, latencyMs: t.latency_ms, tokensKnown: t.usage_known === 1, inputTokens: t.usage_known ? t.input_tokens : null, outputTokens: t.usage_known ? t.output_tokens : null },
      },
      events, proposal, receipt: pay ? (JSON.parse(pay.receipt_json) as unknown) : null,
    };
  }
  app.post("/api/tasks", guard("propose", (req, reply, u) => {
    if (!taskLimiter.allow(`u:${u.userId}`)) return reply.code(429).send({ error: { code: "RATE_LIMITED", message: "Too many tasks started. Wait a minute." } });
    const body = parseInput(z.object({ invoiceId: z.string().max(64), instruction: z.string().max(2000) }).strict(), req.body);
    const t = runner.startTask(u.userId, u.maxTier, body.invoiceId, body.instruction);
    reply.code(202);
    return taskView(u.userId, t.id);
  }));
  app.get("/api/tasks/:id", guard("read", (req, _r, u) => taskView(u.userId, (req.params as { id: string }).id)));
  app.post("/api/tasks/:id/approve", guard("execute", async (req, _r, u) => {
    const body = parseInput(z.object({ proposalHash: z.string().regex(/^[0-9a-f]{64}$/) }).strict(), req.body);
    const id = (req.params as { id: string }).id;
    await runner.approveAndResume(u.userId, u.maxTier, id, body.proposalHash);
    return taskView(u.userId, id);
  }));
  app.post("/api/tasks/:id/cancel", guard("propose", (req, _r, u) => {
    const id = (req.params as { id: string }).id;
    runner.cancel(u.userId, id);
    return taskView(u.userId, id);
  }));

  // ---- direct execution entry point: same server policy as the agent tool ----
  app.post("/api/payments/execute", guard("execute", (req, _r, u) => {
    const b = parseInput(z.object({ proposalId: z.string().max(64), approvalId: z.string().max(64), idempotencyKey: z.string().max(100) }).strict(), req.body);
    return executePayment(ctx, { ownerId: u.userId, tier: u.maxTier, proposalId: b.proposalId, approvalId: b.approvalId, idempotencyKey: b.idempotencyKey });
  }));
  app.post("/api/proposals/:id/approve", guard("execute", (req, _r, u) => {
    const b = parseInput(z.object({ proposalHash: z.string().regex(/^[0-9a-f]{64}$/) }).strict(), req.body);
    return approveProposal(ctx, { ownerId: u.userId, tier: u.maxTier, proposalId: (req.params as { id: string }).id, proposalHash: b.proposalHash });
  }));
  app.get("/api/payments/:id", guard("read", (req, _r, u) => {
    const r = ctx.db.prepare("SELECT receipt_json FROM payments WHERE id = ? AND owner_user_id = ?").get((req.params as { id: string }).id, u.userId) as { receipt_json: string } | undefined;
    if (!r) throw new PolicyError("NOT_FOUND", "Payment not found.");
    return JSON.parse(r.receipt_json) as unknown;
  }));
  app.get("/api/audit", guard("read", (_req, _r, u) => ({
    events: ctx.db.prepare("SELECT ts, task_id, mode, event, result, refs_json FROM audit_events WHERE owner_user_id = ? ORDER BY ts DESC, rowid DESC LIMIT 100").all(u.userId),
  })));

  // ---- demo reset: explicit local demo operation only ----
  app.post("/api/demo/reset", guard("read", (req, _r, u) => {
    if (!ctx.config.demoMode) throw new PolicyError("DEMO_ONLY", "Demo reset is disabled (APP_DEMO_MODE=0).");
    const b = parseInput(z.object({ scenario: z.enum(SCENARIOS as [ScenarioId, ...ScenarioId[]]).default("standard") }).strict(), req.body ?? {});
    resetDemo(ctx, { scenarioFor: { userId: u.userId, scenario: b.scenario } });
    audit(ctx.db, ctx.clock, { ownerUserId: u.userId, event: "demo.reset", result: "INFO", refs: { scenario: b.scenario } });
    return { ok: true, scenario: b.scenario };
  }));

  // ---- static UI (production build) ----
  const webDir = deps.webDir ?? resolve("dist/web");
  if (existsSync(webDir)) {
    app.register(fastifyStatic, { root: webDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Not found." } });
      return reply.sendFile("index.html");
    });
  }
  return app;
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}
export { getTask };
