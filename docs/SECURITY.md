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
| Route objective | the server re-ranks the current quote set when a proposal is created; a feasible but non-optimal or superseded quote is rejected; the ranking evidence is inside the hashed payload | `proposal-guards.test.ts` |
| Cancellation | task transitions are compare-and-set and re-checked after every await; a late model response cannot create a proposal or change a cancelled task; the proposal write itself requires a RUNNING task | `task-lifecycle.test.ts`, `proposal-guards.test.ts` |
| Payment truth | after execution the ledger decides: a stored payment keeps the task COMPLETED even if the explanation call fails; retries replay the receipt | `task-lifecycle.test.ts` |
| Narrative grounding | amounts, statuses and routes shown as facts come from stored records; model prose is withheld if it states an unsupported amount, payment/approval or route claim (an additional control, not a guarantee against every false statement) | `narrative-grounding.test.ts` |
| Ambiguous constraints | non-USD or conflicting reserve amounts are refused for clarification | `reserve-intent.test.ts` |
| Evidence provenance | evaluation reports carry driver, endpoint and source commit; export aborts if the mandatory evaluation fails; a fake, MOCK, failed, stale or report-only live report is never presented as a real-model run | `evidence-chain.test.ts`, `eval-gate.test.ts` |
| Mode separation | the database is stamped live/sandbox and refused in the other mode; registration, attestation and manual offers exist only in live; the simulated ledger and demo reset only in sandbox | `live-mode.test.ts` |
| Trusted recipients (live) | only the signed-in user can attest one (https source, note, IBAN checksum); invoices only select among them by exact account; another user's entry is never trusted | `live-mode.test.ts`, `e2e/live.spec.ts` |
| Source integrity (live) | Wise options kept only if reproducible to the cent; user offers need a source note, recent observation, validity ≤ 7 days and a plausible rate vs the NBK reference; a source outage stores nothing | `live-mode.test.ts` |
| No money movement (live) | approval issues an instruction; no payment or ledger row is written; user evidence is stored with a hash and never called verification; files are checked by signature and size | `live-mode.test.ts` |
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
Earlier, at commit `be50d45`, controls were deliberately broken one at a time to confirm the suites fail (not repeated on later changes): reserve/funds recheck, owner scoping (invoices, tasks), CSRF, reserve-lowering guard, approval-consumed check, approval–hash binding, retry cap, and round-up rounding. One mutation survived: dropping the owner filter on the approval lookup does not change outcomes because the approval must also match the caller's own proposal id, so it is defense-in-depth rather than a gap.

## Known limits (honest)
- Local demo only: HTTP on loopback (no TLS; the cookie is not `Secure` unless configured), demo credentials are documented, single process and a single SQLite file, in-memory rate limiters.
- Approval is an authenticated click bound to a hash, not a hardware- or signature-backed authorization. The audit log is not tamper-evident.
- Simulated payments: no KYC/AML, sanctions screening, real FX, settlement or provider contracts. "Compliance" here means the design controls above, not regulatory approval.
- In LIVE mode, invoice text (including untrusted notes), balances and the instruction are sent to the configured model provider; use only synthetic data. Provider choice, region and data-retention terms for the Shenzhen venue are unconfirmed.
- LIVE behavior is **not verified**: the adapter is tested against a local fake provider only. Server-side controls do not depend on model behavior, but a real model's quality (tool choice, explanations) is unmeasured.
- The agent-driven cases in the evaluation use a deterministic MOCK; the adversarial cases use scripted models. They test the server's policy layer, not a real model's susceptibility to injection.
- A beneficiary mismatch is reported as something to review, not as a proven fraud finding.
