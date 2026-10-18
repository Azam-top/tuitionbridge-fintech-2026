// Server-only configuration. Secrets stay in env and are never serialized to clients or logs.

export type AppMode = "live" | "sandbox";

export interface AppConfig {
  host: string;
  port: number;
  dbPath: string;
  /** live: real users, real model, no fixtures. sandbox: separate database of clearly labeled TEST DATA for the competition check. */
  appMode: AppMode;
  /** True only in sandbox mode (reset endpoint, demo users, scenario data). */
  demoMode: boolean;
  wiseQuotes: boolean;
  nbkRates: boolean;
  uploadDir: string;
  maxUploadBytes: number;
  taskRateLimitPerMinute: number;
  mutateRateLimitPerMinute: number;
  llmApiKey: string | null;
  llmModel: string | null;
  /** Optional provider endpoint override; used to point the adapter at a local fake provider in tests. */
  llmBaseUrl: string | null;
  llmMaxOutputTokens: number;
  taskTokenBudget: number;
  maxToolCalls: number;
  maxModelRequests: number;
  maxTransientRetries: number;
  toolTimeoutMs: number;
  approvalTtlMs: number;
  quoteTtlMs: number;
  cookieSecure: boolean;
  loginRateLimitPerMinute: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const num = (v: string | undefined, d: number) => {
    const n = v === undefined ? NaN : Number(v);
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  const key = env.APP_LLM_API_KEY?.trim();
  const model = env.APP_LLM_MODEL?.trim();
  // APP_MODE wins; APP_DEMO_MODE=1 is kept as an alias for sandbox. The default is the real (live) mode.
  const appMode: AppMode = env.APP_MODE === "sandbox" || (env.APP_MODE === undefined && env.APP_DEMO_MODE === "1") ? "sandbox" : "live";
  return {
    host: env.APP_HOST?.trim() || "127.0.0.1",
    port: num(env.APP_PORT, 8787),
    dbPath: env.APP_DB_PATH?.trim() || (appMode === "sandbox" ? "data/sandbox.sqlite" : "data/live.sqlite"),
    appMode,
    demoMode: appMode === "sandbox",
    wiseQuotes: env.APP_WISE_QUOTES === "1",
    nbkRates: env.APP_NBK_RATES !== "0",
    uploadDir: env.APP_UPLOAD_DIR?.trim() || (appMode === "sandbox" ? "data/uploads-sandbox" : "data/uploads"),
    maxUploadBytes: num(env.APP_MAX_UPLOAD_BYTES, 2 * 1024 * 1024),
    llmApiKey: key ? key : null,
    llmModel: model ? model : null,
    llmBaseUrl: env.APP_LLM_BASE_URL?.trim() || null,
    llmMaxOutputTokens: num(env.APP_LLM_MAX_OUTPUT_TOKENS, 8192),
    taskTokenBudget: num(env.APP_TASK_TOKEN_BUDGET, 80000),
    maxToolCalls: num(env.APP_MAX_TOOL_CALLS, 8),
    maxModelRequests: num(env.APP_MAX_MODEL_REQUESTS, 10),
    maxTransientRetries: num(env.APP_MAX_TRANSIENT_RETRIES, 2),
    toolTimeoutMs: num(env.APP_TOOL_TIMEOUT_MS, 10000),
    approvalTtlMs: num(env.APP_APPROVAL_TTL_MS, 5 * 60_000),
    quoteTtlMs: num(env.APP_QUOTE_TTL_MS, 15 * 60_000),
    cookieSecure: env.APP_COOKIE_SECURE === "1",
    loginRateLimitPerMinute: num(env.APP_LOGIN_RATE_LIMIT, 10),
    taskRateLimitPerMinute: num(env.APP_TASK_RATE_LIMIT, 12),
    mutateRateLimitPerMinute: num(env.APP_MUTATE_RATE_LIMIT, 120),
  };
}

/**
 * LIVE when a key AND model are configured (this does not prove the key works).
 * Without them: the sandbox falls back to the labeled MOCK agent; the live mode has NO fallback and needs setup.
 */
export type AgentStatus = "LIVE" | "MOCK" | "NOT_CONFIGURED";
export function agentStatus(c: AppConfig): AgentStatus {
  if (c.llmApiKey && c.llmModel) return "LIVE";
  return c.appMode === "sandbox" ? "MOCK" : "NOT_CONFIGURED";
}
/** Kept for callers that only distinguish a real model from the stand-in. */
export function agentMode(c: AppConfig): "LIVE" | "MOCK" {
  return c.llmApiKey && c.llmModel ? "LIVE" : "MOCK";
}
