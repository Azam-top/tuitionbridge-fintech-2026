import { ApiFailure } from "./api";

const HINTS: Record<string, string> = {
  PROPOSAL_EXPIRED: "The offer expired before you approved. Press “Plan my payment” again for fresh quotes.",
  QUOTE_EXPIRED: "The offer expired. Plan again for fresh quotes.",
  APPROVAL_EXPIRED: "Your approval window passed. Plan again.",
  APPROVAL_MISMATCH: "What you approved no longer matches the current plan. Review the new plan.",
  PROPOSAL_NOT_PENDING: "This plan is no longer open (it was replaced, rejected or already used).",
  INVOICE_NOT_CONFIRMED: "Confirm the invoice details first.",
  TASK_ACTIVE: "You already have a plan in progress. Approve or reject it first.",
  TASK_STATE: "That plan is not waiting for approval any more.",
  RATE_LIMITED: "Too many requests in a short time. Wait a minute and try again.",
  CSRF: "Your session looks out of date. Reload the page and sign in again.",
  BAD_ORIGIN: "This request came from a different site and was refused.",
  FORBIDDEN_TIER: "This account is not allowed to do that (read-only or propose-only).",
  INTENT_CONFLICT: "Please rewrite the instruction with one clear preference and one non-zero USD reserve.",
  RESERVE_LOWERING: "The living reserve cannot be lowered after you set it.",
  INSUFFICIENT_FUNDS: "Your USD funds do not cover this payment.",
  RESERVE_BREACH: "Paying would dip below your living reserve.",
  DUPLICATE_PAYMENT: "This invoice has already been paid.",
  PROVIDER_FAILURE: "The AI assistant did not respond. Try again.",
};

export function explain(e: unknown, fallback: string): string {
  if (!(e instanceof ApiFailure)) return fallback;
  const hint = HINTS[e.error.code];
  // Show the server's precise message first, then what to do next.
  return hint && !e.error.message.includes(hint) ? `${e.error.message} ${hint}` : e.error.message;
}
