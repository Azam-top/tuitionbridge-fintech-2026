// Server-only configuration. Secrets stay in env and are never serialized to clients or logs.

export interface AppConfig {
  host: string;
  port: number;
  dbPath: string;
  demoMode: boolean;
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
  return {
    host: env.APP_HOST?.trim() || "127.0.0.1",
    port: num(env.APP_PORT, 8787),
    dbPath: env.APP_DB_PATH?.trim() || "data/tuitionbridge.sqlite",
    demoMode: env.APP_DEMO_MODE !== "0",
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
  };
}

/** LIVE only when a key AND model are configured. Does not prove the key works. */
export function agentMode(c: AppConfig): "LIVE" | "MOCK" {
  return c.llmApiKey && c.llmModel ? "LIVE" : "MOCK";
}
