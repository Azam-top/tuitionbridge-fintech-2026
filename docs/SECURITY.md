# Security self-assessment

Scope: a local competition prototype with synthetic data and simulated payments. This is our own assessment, not an independent audit, and it is not a claim of regulatory compliance. Test names refer to files under `tests/` and `eval/`.

## Permission tiers (enforced server-side)
| Tier | Allows | Where enforced |
|---|---|---|
| read | view own state, task, receipt, audit | HTTP guard per route |
| propose | create/edit/confirm invoices, start tasks, `prepare_payment`, cancel | HTTP guard; `startTask`, `prepareProposal` |
| execute | approve proposals, execute payments | HTTP guard; `approveProposal`, `executePayment` |

An account's maximum tier caps what its sessions can do. The **agent** gets `propose` in the pre-approval phase and `execute` only after a human approval record exists, and only through the single tool `execute_sandbox_payment`. There is no approval tool.

## Controls
| Area | Control | Tests |
|---|---|---|
| Authentication | scrypt password hashes; opaque random session token (only its SHA-256 stored); HttpOnly + SameSite=Strict cookie; 8 h expiry; login rate limit | `http.test.ts` |
| Request integrity | CSRF token header on every mutation; Origin must match Host; no CORS; 64 KB body limit (512 KB for the import route); strict Zod schemas that reject unknown fields; security headers incl. CSP | `http.test.ts` |
| Ownership | every query scoped by the session user; foreign ids return 404; client-supplied user ids rejected | `execution.test.ts`, `http.test.ts`, eval `auth-03` |
| Approval | human-only endpoint; bound to proposal id + SHA-256 + owner; expiry; single use; hash must match what the student saw | `execution.test.ts`, eval `auth-01/02` |
| Immutability | SQLite triggers block proposal field updates; execution recomputes the hash and amounts | `execution.test.ts` |
| Atomic execution | one synchronous IMMEDIATE transaction; rollback leaves no partial ledger/approval/invoice change | `execution.test.ts`, `concurrency.test.ts` |
| Idempotency | key bound to a payload hash; same key + same payload → original receipt; same key + different payload → conflict | `execution.test.ts`, eval `dup-01` |
| Duplicates | UNIQUE payment per invoice, per proposal and per approval; different key cannot repay | eval `dup-02/03/04`, `concurrency.test.ts` |
| Concurrency | separate OS processes racing on one SQLite file produce one payment and never breach the reserve | `concurrency.test.ts` |
| Funds | balance and reserve rechecked at execution; ledger totals conserved (invariant checked after every eval case) | eval invariants |
| Prompt injection | invoice text and tool output are untrusted data; they carry no authority; model arguments are schema-validated and constrained to the parsed intent (cannot lower reserve or change a stated preference); unknown/unavailable tools rejected | `agent.test.ts`, eval `inj-01..04` |
| Trusted recipient | beneficiary must equal the fixture registry; documents cannot update it | `agent.test.ts`, `invoice-import.test.ts` |
| Input handling | PDF: magic bytes, size and page caps, timeout, safe errors; text length caps; instruction length cap | `invoice-import.test.ts` |
| Audit | redacted structured events only (ids, codes, hashes); rejections never written as successes | `execution.test.ts` |
| Demo reset | disabled unless `APP_DEMO_MODE` is on; requires a session | `http.test.ts` |
| Network | binds to loopback unless explicitly overridden | `src/server/index.ts` |
| Secrets | keys only from `APP_*` env / `.env`; never logged or returned; provider errors are sanitized | `anthropic-adapter.test.ts`, `agent.test.ts` |

## Attack scenarios tested
Execute with no approval; forged or text-only approval ids; approval bound to a different hash; expired approval, proposal and quote; edited invoice after proposal; another user approving/executing/reading; read-only tier; replayed and conflicting idempotency keys; double-clicked approval; parallel processes; two invoices competing for one balance; invoice notes ordering approval waiver and redirect; a scripted model obeying that injection; model lowering the reserve, flipping the preference, or smuggling a beneficiary argument; instruction text trying to zero the reserve; hostile account in imported text; provider outages and retry exhaustion; oversize bodies and PDFs; cross-origin and CSRF-less mutations.

## Verification of the tests themselves
Controls were deliberately broken one at a time to confirm the suites fail: reserve/funds recheck, owner scoping (invoices, tasks), CSRF, reserve-lowering guard, approval-consumed check, approval–hash binding, retry cap, and round-up rounding. One mutation survived: dropping the owner filter on the approval lookup does not change outcomes because the approval must also match the caller's own proposal id, so it is defense-in-depth rather than a gap.

## Known limits (honest)
- Local demo only: HTTP on loopback (no TLS; the cookie is not `Secure` unless configured), demo credentials are documented, single process and a single SQLite file, in-memory rate limiters.
- Approval is an authenticated click bound to a hash, not a hardware- or signature-backed authorization. The audit log is not tamper-evident.
- Simulated payments: no KYC/AML, sanctions screening, real FX, settlement or provider contracts. "Compliance" here means the design controls above, not regulatory approval.
- In LIVE mode, invoice text (including untrusted notes), balances and the instruction are sent to the configured model provider; use only synthetic data. Provider choice, region and data-retention terms for the Shenzhen venue are unconfirmed.
- LIVE behavior is **not verified**: the adapter is tested against a local fake provider only. Server-side controls do not depend on model behavior, but a real model's quality (tool choice, explanations) is unmeasured.
- The agent-driven cases in the evaluation use a deterministic MOCK; the adversarial cases use scripted models. They test the server's policy layer, not a real model's susceptibility to injection.
- A beneficiary mismatch is reported as something to review, not as a proven fraud finding.
