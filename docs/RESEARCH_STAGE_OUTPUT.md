# TuitionBridge: research-stage output (no implementation)

Date: 2026-10-18. Code checked: commit `be50d45` (current HEAD, clean tree). No application source, deploy, submission, account or paid API call was touched.

Legend: **[V]** verified by me today · **[B]** taken from the audit brief, not re-verified by me · **[H]** hypothesis · **[P]** proposed work · **[?]** unknown.

## 0. Audit findings re-checked on the current code

All six findings are present at `be50d45`. I confirmed them by reading the code; I did not re-run the model-driver probes (that is Stage 1 work, where each becomes a failing regression test first).

| # | Status | Evidence in code |
|---|---|---|
| F1 route objective not enforced | **[V] present** | `tools.ts` `prepare_payment` passes the model's `quote_id` to `prepareProposal`; `proposals.ts:111` only calls `evaluateQuote` (feasibility), never `evaluateRoutes` (ranking). |
| F2 cancel overwritten | **[V] present** | `runner.ts` `cancel` calls `finish(... CANCELLED)`; `loop` awaits the model and `preparePhase` later calls `finish(... AWAITING_APPROVAL)` unconditionally (lines ~163-171). No state re-check after the await. |
| F3 ungrounded summary | **[V] present** | `lastText` (model prose) is stored as `summary` in `finish` (lines 169-185) and emitted as an `assistant` event. |
| F4 explanation failure after payment | **[V] present** | `executePhase` catch → `failTask` → `FAILED` even if `payment_id` is set; `failTask` never consults the payments table. |
| F5 reserve parsing | **[V] present** | `intent.ts:42-48` takes one regex hit (`m2 ?? m1`); the currency capture is not checked against USD; multiple mentions are not detected. |
| F6 live eval exit code | **[V] present** | `scripts/eval/run.ts:95` `const ok = LIVE ? true : ...`; `--max-cases` is not validated. |
| KZT 800,000 vs tuition 500,000 | **[V] present** | `fixtures.ts:37` `DEMO_KZT_BALANCE_TIYN = "80000000"` vs `DEMO_TUITION_TIYN = "50000000"`. |

Reference data re-fetched: NBK feed returned HTTP 200 at 2026-10-18T04:40Z, USD `452.12`, quantity 1, date `18.10.2026`; SHA-256 of the body `c6eb63f0…06dbd` is identical to the brief's capture **[V]**. It is a *reference* rate only.

## 1. Competitor evidence table

All rows **[B]** unless noted. I did not re-open the vendor pages; before any of this goes in the deck, open each URL and record the date.

| Alternative | What it already does | What it does *not* establish for us | Source |
|---|---|---|---|
| Flywire | Tuition payment, local-currency options, tracking, institution reconciliation | Nothing about protecting a student's living budget or comparing across providers | flywire.com/industries/education/solution/payments |
| Convera (students) | Tuition/deposit payments, several funding methods, tracking, multilingual support | Same | convera.com/students |
| University portal (e.g. Temple) | Defines the *accepted* route; Temple names Flywire as the approved incoming international method | One university; not a general rule | bursar.temple.edu/payments/international-payments |
| Transfer services (Wise etc.) | Possible execution partner if payer, institution, currency and route are supported; Wise sandbox coverage is limited | USD→KZT in the sandbox is untested | docs.wise.com/guides/developer/environments |
| Spreadsheet + message to finance office | Plausible current workaround **[H]** | Must be confirmed in interviews | n/a |

Takeaway **[H]**: tuition transfer and tracking are not novel. The only defensible claim is the *pre-payment decision layer*: accepted route first, then price, deadline and protected living funds, then exact-terms approval.

## 2. User and buyer hypothesis

- **User [H]:** international student paying Kazakhstan-bound tuition from foreign funds, with a hard deadline and a rent/food budget they cannot touch. Population context **[B]**: 35,075 foreign students from 88 countries in 2025-26 (Kazakhstan ministry). That shows an accessible group, not demand.
- **Job [H]:** "Tell me which accepted way to pay is feasible by the deadline, what I'll have left, and let me approve exactly that."
- **Buyer [H]:** a university international office or education-support organization that fields repeated payment questions. Student-pays-directly is a weak buyer. No price, revenue or willingness-to-pay exists; none will be claimed.
- **Referral revenue:** only with a real agreement and disclosure; it must never influence ranking.
- **What would weaken it:** students already finish the task confidently via the prescribed portal; no repeated unresolved problem emerges; the real pain is institution onboarding/exceptions rather than route choice. Then pivot to institution-specific onboarding, not more currencies or animation.
- **Discovery plan [P]:** 5 recent payers + 1 person who answers payment questions. Ask about the *last actual payment*: route, what the institution required, fees known beforehand, delays, how the beneficiary was checked, whether a living budget shaped the choice. Have them explain the approval card unaided. No banking credentials or statements. The counts are practical, not statistical. Results must come from the humans; I will not write any.

## 3. Data-source matrix

| Field | Class | Acceptable source | What UI may claim | Available today? |
|---|---|---|---|---|
| Invoice amount, due date | `document_extracted` → user-confirmed | Uploaded text/PDF + explicit field confirmation | "Confirmed by you" | Yes (parser exists; confirmation exists) |
| Beneficiary account | `test_fixture` today | Needs an independently maintained institutional source | Currently: "matched test registry" only | **No real source** |
| USD balance | `user_declared` | User input | "Self-reported" | Fixture today; no input form **[V: fixtures.ts]** |
| Living-expense reserve | `user_declared` | User input | "Protected by you" | Yes (via instruction) |
| Reference FX USD→KZT | `public_reference` | NBK RSS (effective date, retrieval time) | "NBK reference rate, not an offer" | **Yes [V]** |
| Executable FX, fee, ETA, expiry | `provider_sandbox/live` | Provider response for this specific payment | Terms with expiry | **No** (3 `test_fixture` quotes) |
| Institution-accepted routes | needs a source | Official university payment page, captured with date | "Per <page>, <date>" | Manual capture only |
| Payment status | ledger or provider events | Local ledger (sandbox) / provider status | Exactly what the evidence shows | Local ledger only |
| Model narrative | derived | Validated references to rows above | Explanation, never a fact source | MOCK only; LIVE never run |

Unavailable and must stay "unknown": real provider fees, ETAs, cutoffs/holidays, institution posting delays, beneficiary verification. Rule: unknown total cost cannot win a cheapest ranking; network failure never creates offers.

## 4. Recommended flow and component mapping

Add invoice → Confirm details and funding → Compare eligible options → Review exact action → Approve → Actual status/receipt. One primary action per stage; compact invoice + protected-budget summary persistent.

| Stage | Existing component | Change [P] |
|---|---|---|
| Add invoice | `ImportCard.tsx`, `InvoiceCard.tsx` | Merge into one guided step; show extraction coverage and missing fields |
| Confirm + funding | `InvoiceCard.tsx`, `App.tsx` balances | Editable self-reported funds/reserve; drop the unused KZT line |
| Compare | `TaskPanel.tsx` route table | Eligible-only ranking; exclusions explained; mobile cards |
| Review/Approve | approval card in `TaskPanel.tsx` | Lead with receives / total debit / money left / arrival / expiry; hashes behind "details" |
| Result | receipt in `TaskPanel.tsx` | Render from stored receipt only, never `task.summary` |
| Diagnostics | tool timeline, usage, `GuidedDemo.tsx` | Move into a details/presenter panel |

Visual references (DataRain, DyeWhorl, Magic UI): **optional**, at most one effect on the landing/onboarding view, never behind comparison or approval facts, reduced-motion respected. Their source URLs and licenses are **[?]** and must be checked before any reuse. The repo uses plain CSS, so no Tailwind/shadcn migration.

## 5. Bounded scope

**In (before 19 Oct submission):** Stage 1 fixes F1-F7; one real model run if the humans provide a key and limit; UI hierarchy cleanup; NBK reference display *only if time remains*; regenerated evidence/deck/demo from the final commit.
**Out:** a real payment provider, new currencies, a fraud engine, GraphRAG, any fabricated interview, KYC/AML claims.
**Conditional:** external sandbox (needs credentials and confirmed route support).

## 6. Acceptance cases (new; refusal/clarification count as valid outcomes)

1. Cheapest instruction, model submits costlier A → rejected or replaced by C; fastest → A. No stale/missing ranking yields an "optimal" proposal.
2. Cancel during an outstanding model call → stays CANCELLED, no proposal, next task unaffected.
3. Model says "Paid successfully" with no tool call → never rendered as a fact; no payment.
4. Fault injected after ledger commit → payment present, receipt returned, retry cannot debit twice; fault *before* commit → no payment.
5. `keep EUR 500` → clarification; `keep USD 300 … USD 500` → clarification; existing EN/RU examples still pass.
6. Failing or empty live-eval selection → non-zero exit; `--max-cases` bounded.
7. Scenario funds consistent with USD-only scope.
8. Also: missing fee stays unknown and cannot win; stale quote; unsupported institution route; mixed data classes; source outage; wrong model amount.

## 7. Model and account requirements

- App runtime needs its own legitimate key and `APP_LLM_MODEL`; the Claude Code subscription does not fund it **[B]**. I will not read `ANTHROPIC_API_KEY` or run `smoke:live` / `eval:live` without the user's explicit key and spending limit.
- Candidate models named in the brief (Sonnet 5.5, Haiku 5.5) **[B]**; check current docs for supported parameters before setting temperature or `tool_choice`.
- Shenzhen venue: provider availability is **[?]** and must be asked of organizers. The brief cites regional restrictions; I have not re-verified them.
- Record on any live run: model ID, requests, provider-reported usage, latency, failures. No cost estimate from fictional tokens.

## 8. Next implementation plan (starts only on the user's go-ahead)

1. F1 → server-side best-route enforcement + test (red first).
2. F2 → terminal cancellation (conditional state updates, post-await checks).
3. F3 → summaries derived from DB records; UI stops rendering raw model prose as fact.
4. F4 → payment-aware failure handling.
5. F5 → currency/multiplicity-aware reserve parsing.
6. F6 → live-eval gate + fake-transport test.
7. F7 → consistent USD-only scenario.
8. Regenerate eval/evidence; run typecheck, 102 tests, e2e (needs Chrome), build.
9. UI restructure, then deck/demo regeneration from the final commit.
10. Human-owned: interviews, code-walkthrough names in `AI_USAGE.md`, organizer questions, submission receipt.

## 9. Open decisions for the user

- OK to start Stage 1 now?
- Will you supply an API key and a spending limit for a real model run? Without it LIVE stays unverified.
- Which mode for the funds story: USD-only (KZT = 0) or direct-KZT funding?
