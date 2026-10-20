# TuitionBridge: project spec (Session 1 contract)

Competition prototype for Topic C, 2026 Shenzhen International FinTech Competition, International Track.
Two modes. LIVE (default): real accounts, real invoice, a required real model, sources named per number; the app moves NO money and issues a payment instruction. SANDBOX: a separate stamped database of fictional TEST DATA with a MOCK agent and a SIMULATED ledger, used for the competition check and the 30 evaluation cases.

## Task
Confirmed invoice -> declared funds -> sourced USD->KZT offers (Wise public quote API, user-entered offers, NBK reference rate) -> server-ranked feasible route -> immutable proposal -> explicit human approval -> payment instruction (live) or sandbox ledger execution (sandbox) -> user evidence / receipt + audit log.

## Competition facts (from the organizer brief; not scoring promises)
- International Track rubric: task completion 40%, security/compliance 30%, innovation/interaction 30%.
- Deadline 20 Oct 2026 23:59 Beijing (20:59 Almaty). Plan to submit 19 Oct. English only.
- Needed: technical + security docs, source/README/tests, <=10 min pitch, sandbox logs, <=5 min demo video.

## Unknowns (human must confirm; do not claim resolved)
1. Which rubric governs: track brief (above) vs general site (implementation completeness / innovation / business value, also 40/30/30).
2. Whether AI-assisted coding must be disclosed (AI_USAGE.md is written regardless).
3. Final defense format; whether recordings/offline replay are allowed.
4. A supported inference provider on site in Shenzhen (Anthropic does not support mainland China).
5. Registration contact: IEEE and CMU notices list different emails.
6. Real student evidence: none collected yet; the problem statement is a labeled hypothesis.

## Money contract
- USD cents / KZT tiyn as BigInt internally; integer strings on the wire and in hashes; rate is an exact decimal string (<=6 fractional digits).
- principal_cents = ceil(tuition_tiyn / rate); total_debit = principal + fixed USD fee; recipient_tiyn = floor(principal * rate) and must cover tuition; surplus is displayed.
- No second FX margin. Currencies are never added together. Existing KZT funds are untouched in this USD-funded flow (stated limitation).
- Reference fixture: tuition KZT 500,000; USD 1,500; reserve USD 300; deadline T+48h.
  A: rate 495, fee 15, arrives T+6h, total USD 1,025.11 (surplus KZT 4.45). B: rate 505, fee 5, T+72h, total 995.10 (late, excluded). C: rate 500, fee 10, T+24h, total 1,010.00 (USD 490.00 left).
  Cheapest-feasible -> C. Faster -> A.
- Eligible route = supported pair, eligible, unexpired at evaluation AND execution, arrives by deadline, amount in range, leaves reserve intact. Ranking: cheapest = debit, arrival, fee, quote id; fastest = arrival, debit, fee, quote id.

## Security contract
- Server sessions (opaque HttpOnly SameSite=Strict cookie), CSRF token header + Origin check, same-origin hosting, loopback bind, input limits, rate limits.
- Every record is owner-scoped. Tiers: read < propose < execute, enforced by the server.
- Proposal is immutable and bound by SHA-256 over canonical JSON of owner, invoice, recipient, currencies, amounts, fee, rate, quote id+version, arrival, deadline, reserve, expiry. Approval is a server-created record bound to proposal id + hash + owner, with expiry, consumed on use.
- No model-callable approval tool. The model only sees `execute_sandbox_payment` after a human approval exists; the tool still runs the same server policy.
- Execution is ONE synchronous SQLite transaction (no await/model/network inside): recheck owner, tier, approval, quote freshness, invoice unpaid, balance, reserve; write payment + ledger entries; mark invoice paid; consume approval.
- Idempotency key bound to payload hash; unique payment per invoice and per proposal.
- Invoice text and tool output are untrusted data. Trusted recipient registry cannot be changed by documents.
- Audit log stores redacted structured fields only.

## Agent contract
- Tools: parse_invoice, get_balances, get_quotes, evaluate_routes, prepare_payment, execute_sandbox_payment.
- Persisted task states: RUNNING -> AWAITING_APPROVAL -> EXECUTING -> COMPLETED | BLOCKED | FAILED | CANCELLED.
- Limits per task (across both phases): 8 tool calls, 10 model requests, 2 transient retries, token budget, tool timeouts. One active task per user. Hitting a limit fails visibly.
- Modes: the sandbox always shows agent MOCK and payments SIMULATED; the live mode shows them in a collapsed "Technical details" section, and shows "Setup required" in the main screen when no model is configured. REPLAY for offline records. MOCK is never presented as a verified live run.

## Phase gates
- Session 1 gate: core flow persists a real sandbox ledger change after human approval; deterministic financial/security tests + browser flow pass; typecheck + build pass; a real provider adapter exists; live status recorded honestly.
- Critical tests are individual pass/fail gates: approval bypass, forged approval, cross-user access, duplicate payment (same and different key), concurrent debit, balance/reserve corruption.
- Session 2: 30-case evaluation, UI polish + guided scenarios, evidence export, docs, deck, demo script, package.
