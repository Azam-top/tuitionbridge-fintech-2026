export type ErrorCode =
  | "FORBIDDEN_TIER" | "NOT_FOUND" | "VALIDATION" | "INVOICE_NOT_CONFIRMED" | "INVOICE_ALREADY_PAID"
  | "QUOTE_EXPIRED" | "QUOTE_MISMATCH" | "ROUTE_NOT_FEASIBLE" | "APPROVAL_MISSING" | "APPROVAL_EXPIRED"
  | "APPROVAL_CONSUMED" | "APPROVAL_MISMATCH" | "PROPOSAL_NOT_PENDING" | "PROPOSAL_EXPIRED" | "PROPOSAL_TAMPERED"
  | "INSUFFICIENT_FUNDS" | "RESERVE_BREACH" | "DEADLINE_MISSED" | "IDEMPOTENCY_CONFLICT" | "DUPLICATE_PAYMENT"
  | "TASK_ACTIVE" | "TASK_STATE" | "LIMIT_REACHED" | "PROVIDER_FAILURE" | "RECIPIENT_MISMATCH"
  | "RESERVE_LOWERING" | "INTENT_CONFLICT" | "DEMO_ONLY" | "ROUTE_NOT_OPTIMAL" | "QUOTE_SUPERSEDED";

/** Expected, user-facing policy failure. Carries a stable code; message contains no secrets. */
export class PolicyError extends Error {
  constructor(public readonly code: ErrorCode, message: string, public readonly details?: Record<string, unknown>) {
    super(message);
    this.name = "PolicyError";
  }
}
