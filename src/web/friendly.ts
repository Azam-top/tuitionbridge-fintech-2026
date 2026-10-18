import { ApiFailure } from "./api";

const HINTS: Record<string, string> = {
  PROPOSAL_EXPIRED: "The quote expired before you approved, so nothing was paid. Press “Plan my payment” again for fresh quotes.",
  QUOTE_EXPIRED: "The quote expired, so nothing was paid. Plan the payment again for fresh quotes.",
  APPROVAL_EXPIRED: "Your approval window passed, so nothing was paid. Plan the payment again.",
  APPROVAL_MISMATCH: "What you approved no longer matches the proposal on record. Nothing was paid; review the new proposal.",
  PROPOSAL_NOT_PENDING: "This proposal is no longer open (it was replaced, rejected or already used). Nothing further was paid.",
  INVOICE_NOT_CONFIRMED: "Confirm the invoice details first; the agent only works on invoices you have confirmed.",
  TASK_ACTIVE: "You already have a payment task in progress. Approve or reject it before starting another.",
  TASK_STATE: "That task is not waiting for approval any more.",
  RATE_LIMITED: "Too many requests in a short time. Wait a minute and try again.",
  CSRF: "Your session looks out of date. Reload the page and sign in again.",
  BAD_ORIGIN: "This request came from a different site and was refused.",
  FORBIDDEN_TIER: "This account is not allowed to do that (read-only or propose-only).",
  INTENT_CONFLICT: "Please rewrite the instruction with one clear preference and one non-zero USD reserve.",
  RESERVE_LOWERING: "The living-expense reserve cannot be lowered by the agent.",
  INSUFFICIENT_FUNDS: "Your USD balance does not cover this payment. Nothing was paid.",
  RESERVE_BREACH: "Paying would dip below the living-expense reserve. Nothing was paid.",
  DUPLICATE_PAYMENT: "This invoice has already been paid. Nothing further was charged.",
  PROVIDER_FAILURE: "The model provider failed. A payment exists only if a receipt is shown; a recorded payment is never undone by this error.",
};

export function explain(e: unknown, fallback: string): string {
  if (!(e instanceof ApiFailure)) return fallback;
  const hint = HINTS[e.error.code];
  // Show the server's precise message first, then what to do next.
  return hint && !e.error.message.includes(hint) ? `${e.error.message} ${hint}` : e.error.message;
}
