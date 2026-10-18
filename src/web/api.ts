export interface ApiError { code: string; message: string; details?: unknown }
export class ApiFailure extends Error {
  constructor(public status: number, public error: ApiError) { super(error.message); }
}

let csrf = "";
export const setCsrf = (t: string) => { csrf = t; };

export async function api<T>(method: "GET" | "POST" | "PATCH", url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(method !== "GET" ? { "x-csrf-token": csrf } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
  if (!res.ok) {
    const e = (json as { error?: ApiError } | null)?.error ?? { code: "HTTP_" + res.status, message: `Request failed (${res.status}).` };
    throw new ApiFailure(res.status, e);
  }
  return json as T;
}

// ---- response types (mirror the server views; amounts are integer strings of minor units) ----
export interface Config {
  agentMode: "LIVE" | "MOCK"; liveVerifiedInThisDatabase: boolean; payments: "SIMULATED"; replay: boolean; demoMode: boolean;
  scenarios: string[]; fixturesVersion: string; limits: { maxToolCalls: number; maxModelRequests: number; maxTransientRetries: number; approvalMinutes: number };
}
export interface Issue { code: string; field?: string; message: string }
export interface Invoice {
  id: string; reference: string; recipientRegistryId: string; beneficiaryName: string; beneficiaryAccount: string;
  amountKztTiyn: string; dueAt: string; sourceType: string; notes: string; ambiguousFields: string[];
  status: "DRAFT" | "BLOCKED" | "CONFIRMED" | "PAID"; issues: Issue[]; confirmedAt: string | null;
}
export interface Balances {
  usd: { balanceCents: string; reserveCents: string; availableCents: string };
  kzt: { balanceTiyn: string };
  note: string;
}
export interface TaskSummary { id: string; state: string; mode: "LIVE" | "MOCK"; model: string | null; invoiceId: string; proposalId: string | null; paymentId: string | null; summary: string | null; error: string | null }
export interface StateResponse { user: { email: string; displayName: string; maxTier: string }; config: Config; balances: Balances; invoices: Invoice[]; latestTask: TaskSummary | null; now: string }
export interface Proposal {
  id: string; status: string; hash: string; createdAt: string; expiresAt: string;
  display: { usdBalanceBeforeCents: string; usdAfterCents: string };
  approval: { id: string; approvedAt: string; expiresAt: string; consumedAt: string | null } | null;
  payload: {
    invoiceReference: string; recipientRegistryId: string; beneficiaryName: string; beneficiaryAccount: string; tuitionTiyn: string; rate: string;
    feeCents: string; principalCents: string; totalDebitCents: string; recipientTiyn: string; surplusTiyn: string; quoteId: string; quoteVersion: number;
    providerName: string; estArrivalAt: string; deadlineAt: string; quoteExpiresAt: string; reserveCents: string; preference: string; proposalExpiresAt: string;
  };
}
export interface TaskEvent { seq: number; kind: string; tool: string | null; ok: boolean | null; text: string | null; at: string; input: unknown; output: Record<string, unknown> | null }
export interface Receipt {
  paymentId: string; disclaimer: string; invoiceReference: string; provider: string; rate: string; principalCents: string; feeCents: string; totalDebitCents: string;
  tuitionTiyn: string; recipientTiynCredited: string; surplusTiyn: string; roundingNote: string; beneficiaryName: string; recipientRegistryId: string;
  beneficiaryAccount: string; estArrivalAt: string; deadlineAt: string; usdBalanceBeforeCents: string; usdBalanceAfterCents: string; reserveCents: string;
  executedAt: string; proposalHash: string; approvalId: string; idempotencyKey: string;
}
export interface TaskView {
  task: TaskSummary & {
    instruction: string;
    intent: { preference: string | null; preferenceSource: string | null; reserveCents: string; reserveSource: string; language: string };
    usage: { toolCalls: number; modelRequests: number; retries: number; latencyMs: number; tokensKnown: boolean; inputTokens: number | null; outputTokens: number | null };
  };
  events: TaskEvent[]; proposal: Proposal | null; receipt: Receipt | null;
}
export interface RouteRow {
  quoteId: string; provider: string; feasible: boolean; rate?: string; totalDebit: string; fee: string; recipientWillReceive: string; roundingSurplus: string;
  usdAfterPayment: string; estArrivalAt: string; expiresAt: string; exclusions: { code: string; message: string }[];
}
