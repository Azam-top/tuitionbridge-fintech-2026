# TuitionBridge architecture

Everything runs in one local Node process plus a SQLite file. All data and all payments are synthetic/simulated.

```
 Browser (React, same origin)
        │  HTTPS-less loopback, cookie session + CSRF header
        ▼
 Fastify HTTP API  ── auth, Origin/CSRF, rate limits, schema validation (Zod), owner scoping
        │
        ├── services/   invoices · invoice-import · quotes · proposals · execution · ledger · audit · seed
        │                (pure rules in src/shared: money, policy, canonical JSON, intent parser)
        ├── agent/      runner (bounded loop, persisted task) · tools · intent guard · LLM interface
        │                 ├─ mock-llm    deterministic stand-in (MOCK)
        │                 └─ anthropic-llm  official SDK adapter (LIVE when a key+model are configured)
        ▼
 SQLite (better-sqlite3): users, sessions, ledger accounts/entries, invoices, quotes, proposals,
                          approvals, agent tasks/events, payments, idempotency keys, audit events
```

## Responsibilities
- **Deterministic code owns money and authority.** Arithmetic, route ranking, approval validity and execution are plain TypeScript. The model only chooses which tool to call and explains tool results.
- **The model never sees approval as a capability.** Pre-approval tools: `parse_invoice`, `get_balances`, `get_quotes`, `evaluate_routes`, `prepare_payment`. `execute_sandbox_payment` is exposed only in the post-approval phase, and it still calls the same `executePayment` policy as the HTTP entry point.
- **Evidence is the database.** The UI timeline, the audit log and the exported evidence are read back from stored tool events, not generated text.

## Task lifecycle
`RUNNING → AWAITING_APPROVAL → EXECUTING → COMPLETED`, with `BLOCKED` (policy/no route/rejection), `FAILED` (provider failure, limits, interruption) and `CANCELLED` (student rejects). A proposal that expires while waiting blocks the task lazily. One active task per user. Limits across both phases: 8 tool calls, 10 model requests, 2 transient retries, a token budget, per-tool timeouts. The pre-approval phase reserves 2 model requests and 1 tool call so execution can always finish. Hitting a limit fails the task visibly.

## Money model
- USD in cents, KZT in tiyn, as `BigInt`; integer strings on the wire and in hashes; rates as exact decimal strings (≤6 fractional digits).
- `principal_cents = ceil(tuition_tiyn / rate)`; `total_debit = principal + fixed_fee_cents`; `recipient_tiyn = floor(principal * rate)` (never overstates delivery; must cover tuition); surplus = `recipient − tuition`. No second FX margin.
- Worked example (tuition KZT 500,000 = 50,000,000 tiyn):

| Quote | Rate | Fee | Principal | Total debit | Recipient gets | Surplus | Arrival (est.) | Result vs deadline T+48h |
|---|---|---|---|---|---|---|---|---|
| A FastLane | 495 | 15.00 | 1,010.11 | **1,025.11** | KZT 500,004.45 | 4.45 | T+6h | feasible (faster) |
| B BudgetBridge | 505 | 5.00 | 990.10 | **995.10** | KZT 500,000.50 | 0.50 | T+72h | **excluded: late** |
| C SteadyPay | 500 | 10.00 | 1,000.00 | **1,010.00** | KZT 500,000.00 | 0.00 | T+24h | feasible (cheapest) → USD 490.00 left |

## Route ranking (`src/shared/policy.ts`)
A route is ranked only if all hold: supported pair (USD→KZT), provider-eligible, quote unexpired, amount within provider range, estimated arrival ≤ deadline, `balance − total_debit ≥ reserve`. Excluded routes carry factual reason codes (`LATE`, `EXPIRED`, `RESERVE_BREACH`, `INSUFFICIENT_FUNDS`, `AMOUNT_OUT_OF_RANGE`, `NOT_ELIGIBLE`, `UNSUPPORTED_PAIR`, `INVALID_QUOTE`). Ordering is total and deterministic:
- cheapest: total debit, then earliest arrival, then lowest fee, then quote id;
- fastest: earliest arrival, then total debit, then lowest fee, then quote id.
If nothing qualifies, no proposal is created.

## Proposal, approval, execution
1. `prepare_payment` creates a proposal bound by SHA-256 over the canonical JSON (sorted keys, string amounts) of owner, invoice, recipient, currencies, amounts, fee, rate, quote id and version, arrival, deadline, quote expiry, reserve and proposal expiry. SQLite triggers make the stored fields immutable.
2. The authenticated human approval endpoint records an approval bound to the proposal id and hash (the hash the student saw must match), valid for ≤5 minutes and never past quote expiry.
3. `executePayment` is **one synchronous `BEGIN IMMEDIATE` transaction** (no `await`, model call or network call inside): recheck tier, idempotency, proposal state/expiry/hash, approval binding/expiry/consumption, invoice unpaid and unchanged, trusted recipient, quote freshness, recomputed amounts, balance and reserve; then write the payment, four ledger entries (user USD −, settlement USD +, settlement KZT −, university KZT +), mark the invoice paid, consume the approval, store the idempotency key, audit. Any failure rolls everything back.

## Invoice input
Manual form, a synthetic example, pasted text and text-based PDFs (`pdfjs-dist`, ≤300 KB, ≤5 pages). Extraction is a draft: ambiguous or missing fields block confirmation until the student re-enters them; the trusted recipient registry is never used to fill gaps. A beneficiary that differs from the registry blocks the invoice with a "mismatch to review", not a fraud accusation. No OCR.

## Modes and labels
In the sandbox these are always visible in the header; in the live mode they sit in the collapsed "Technical details" section (the main screens stay about the payment). `AGENT: MOCK|LIVE`, `PAYMENTS: SIMULATED` (always in the sandbox), `REPLAY` for the offline evidence viewer. LIVE shows "(unverified)" until a LIVE task with provider-reported usage exists in the database.

## Live mode and sandbox (added)

`APP_MODE=live` (default) or `sandbox`. The database file is stamped in `app_meta`; the wrong mode refuses to open it.

**Sources (live).** `services/offers.ts` turns the Wise public quote response into quote rows (`provenance = PROVIDER_LIVE`, with rate type, expiry, creation time, price reference) and stores user-entered offers (`USER_DECLARED`, with source note and observation time). An option is kept only if `ceil(tuition / rate) + fee` equals Wise's `sourceAmount` to the cent. `services/reference-rate.ts` stores the NBK USD rate with effective date, retrieval time and the SHA-256 of the response body. Network calls happen before the agent loop (never in a tool and never inside a database transaction).

**Agent (live).** `runner.preparePhase` gathers sources first, then runs the same bounded loop. `get_quotes` only returns stored, unexpired quotes (no quote is ever issued by the server); an empty set gives `NO_OFFERS`. The proposal payload binds `quoteProvenance`, `quoteSourceNote` and `quoteObservedAt`. The server still re-ranks and rejects a non-optimal quote.

**Execution (live).** `services/instructions.ts` runs one synchronous transaction after the human approval: re-checks hash, approval, quote expiry, deadline, funds and reserve, writes `payment_instructions`, consumes the approval and locks the invoice (`INSTRUCTED`). No ledger entry is written. `payment_evidence` stores the user's mark and uploads (signature-checked PDF/PNG/JPEG, size-capped, SHA-256, owner-scoped); labels say the app did not verify them. Task state `APPROVED` means "instruction issued", never "paid".

**Sandbox.** Unchanged: fixtures, `MockLlm`, `execution.ts` with the simulated ledger, scenarios and the 30 evaluation cases.
