# Handoff (after stage 1 hardening and the UI redesign, 2026-10-18)

## State
Session 1 core + Session 2 deliverables are built and verified locally. Agent is MOCK by default; payments always SIMULATED. **Not competition-ready until the human items below are done.**

## Verified (measured; source commit `9a3f2b5`)
All numbers below come from `artifacts/evidence/test-summary.json`, `eval-mock.json` and `manifest.json`, generated from a CLEAN tree at source commit **9a3f2b57738cc8169f21f790040df4e6ccd0d1a6** (Node v26.11.1). The commit that carries these artifacts is the next one; it changes artifacts and docs only. `npm run package` refuses to run if the artifacts do not share one clean source commit or if sources changed since (it writes `PACKAGE_INFO.json`).
- Type check pass; unit/integration **155/155** (14 files); Playwright browser **17/17** (system Chrome); production build pass.
- Deterministic evaluation: **30/30**, critical **12/12**, unauthorized payments **0**, release gate PASS (MOCK + scripted drivers; says nothing about a real model).
- Real-model evaluation: **LIVE NOT RUN** (`liveEvaluation.status = NOT_RUN`). Nothing here has contacted a model provider. The five-case live pack, its spending ceilings and the verification rules are in `docs/LIVE_RUN.md`; they were exercised only against the MOCK agent and a local fake provider.
- Demo video re-recorded from the redesigned UI (MOCK agent, captions, no narration, 1 min 42 s). Deck, screenshots, evidence viewer and `docs/DEPENDENCIES.md` regenerated.
- Not repeated on later changes: the manual mutation check (11 runs at commit `be50d45`: 9 caught at once, 1 needed an added test, 1 equivalent mutant). Not run: Node 24 (installed Node is 26.x).

## Stage 1 (audit findings, all fixed with regressions)
F1 server-enforced best route (evidence in the hashed payload); F2 terminal cancellation (compare-and-set, re-check after every await, write-time task-state guard on proposals); F3 summaries from stored records and withheld unsupported model prose (an additional control, not a guarantee); F4 recorded payment keeps the task COMPLETED if the explanation fails; F5 ambiguous or non-USD reserves need clarification; F6 evaluation exit code is a real gate (`--report-only` is explicit; `--max-cases` bounded); F7 USD-only demo scenario (KZT balance 0). Evidence chain: the mandatory evaluation runs first and aborts the export on failure; the deck and evidence treat a live report as real-model evidence only if its content and provenance qualify (a fake, MOCK, failed, stale, dirty or report-only report never does). UI: stepper with one next step, budget bar, route cards, structured approval card, technical details collapsed. A reviewer patch (no secrets) was prepared outside the repo at `~/Desktop/tuitionbridge-stage1-review/`.

## Commands
`npm run build && npm run start` · `npm run typecheck|test|test:e2e|eval|evidence|deck|demo:capture|test:summary|licenses|package` · `npm run smoke:live` and `APP_EVAL_LIVE=1 npm run eval:live -- --max-cases=6` (need a key; spend credits; NOT run).

## Deliverable paths
README.md · docs/{ARCHITECTURE,SECURITY,PROJECT_SPEC,DEMO_SCRIPT,PITCH_QA,DEPENDENCIES}.md · AI_USAGE.md · SUBMISSION_CHECKLIST.md · docs/deck/{index.html, TuitionBridge_pitch.pdf, TuitionBridge_pitch_with_notes.pdf} · artifacts/evidence/{viewer.html, success-run.json, malicious-case.json, eval-mock.json, test-summary.json, manifest.json} · artifacts/demo/tuitionbridge-demo-mock.mp4 (1:40, captions, no narration; .webm master is git-ignored from the package) · dist-submission/ (zip + tar.gz, git-ignored).

## Decisions
UI: guided demo (4 scenarios + more datasets), stepper, friendly errors, approval card focus. Login rate limit configurable (`APP_LOGIN_RATE_LIMIT`; e2e raises it). Deck numbers come from measured files and the policy code. Evidence = real runs read back from the DB (MOCK), plus a labeled REPLAY viewer.

## Stage 1 hardening (audit findings F1-F7, 2026-10-18; uncommitted)
- F1 `prepareProposal` re-ranks the latest quote set and rejects non-best (`ROUTE_NOT_OPTIMAL`) or superseded (`QUOTE_SUPERSEDED`) quotes; ranking evidence is in the hashed payload (`selection`).
- F2 task transitions are compare-and-set; every await re-checks ownership, so a late model response after cancel is discarded.
- F3 summaries come from stored proposal/receipt/tool results (`agent/outcome.ts`); model prose is shown only if `agent/grounding.ts` finds no unsupported amount, payment/approval claim or route claim, else an `assistant_withheld` event.
- F4 after the execute phase the ledger decides: a payment row => COMPLETED, even if the explanation call failed.
- F5 reserve parser collects all mentions: non-USD currency or differing amounts => INTENT_CONFLICT.
- F6 `scripts/eval/gate.ts`: live/mock exit code is a real gate; `--report-only` is the explicit observational mode; `--max-cases` is bounded 1-30. Optional `APP_LLM_BASE_URL` points the adapter at a local fake provider (tests only).
- F7 demo KZT balance is 0 (USD-only scenario).
- New tests: `tests/hardening.test.ts`, `tests/eval-gate.test.ts`. Evidence/deck/demo are NOT yet regenerated for this change.

## Remaining human blockers (details in SUBMISSION_CHECKLIST.md)
1. **LIVE model never run**: needs your own key and an explicit budget; follow `docs/LIVE_RUN.md`, then re-export evidence/deck.
2. No student interviews (deck slides 2 and 10 have TODOs).
3. AI_USAGE.md human-review section is blank; the team must read and understand money math, approval gate, tool loop, ledger transaction.
4. Narrated rehearsal not done; the re-recorded video is captions-only, MOCK.
5. Organizer questions unanswered: governing rubric, AI-code disclosure, final format/recording allowed, venue inference provider, under-18 rules, registration/submission channel (IEEE vs CMU emails differ).
6. Project license not chosen; Node 24 and a teammate's machine untested.
7. Submit by 19 Oct; hard deadline 20 Oct 23:59 Beijing (20:59 Almaty).

## If resuming
After any change to sources: commit them, then on the clean tree run `npm run build && npm run test:summary && npm run evidence && npm run demo:capture && npm run deck && npm run licenses`, commit the artifacts, then `npm run package`. Do not edit evidence by hand.
