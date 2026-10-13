# Handoff (end of Session 2)

## State
Session 1 core + Session 2 deliverables are built and verified locally. Agent is MOCK by default; payments always SIMULATED. **Not competition-ready until the human items below are done.**

## Verified this session (measured; see artifacts/evidence/test-summary.json, eval-mock.json)
- Type check pass; 102 unit/integration tests pass; 14 Playwright browser tests pass (system Chrome); production build pass.
- Deterministic evaluation: 30/30 cases, 12/12 critical gates, 0 unauthorized payments (MOCK + scripted drivers; says nothing about a real model).
- Evaluation and test controls were manually broken one at a time (11 runs): 9 caught at once, 1 needed an added test, 1 equivalent mutant (approval owner filter is defense-in-depth).
- Package built from an allowlist with a secret scan (scanner verified against a planted key); extracted into a clean directory: `npm ci`, typecheck, tests, build, eval, e2e and server start all pass. (That check found and fixed a real defect: concurrency tests needed `data/` to exist.)

## Commands
`npm run build && npm run start` · `npm run typecheck|test|test:e2e|eval|evidence|deck|demo:capture|test:summary|licenses|package` · `npm run smoke:live` and `APP_EVAL_LIVE=1 npm run eval:live -- --max-cases=6` (need a key; spend credits; NOT run).

## Deliverable paths
README.md · docs/{ARCHITECTURE,SECURITY,PROJECT_SPEC,DEMO_SCRIPT,PITCH_QA,DEPENDENCIES}.md · AI_USAGE.md · SUBMISSION_CHECKLIST.md · docs/deck/{index.html, TuitionBridge_pitch.pdf, TuitionBridge_pitch_with_notes.pdf} · artifacts/evidence/{viewer.html, success-run.json, malicious-case.json, eval-mock.json, test-summary.json, manifest.json} · artifacts/demo/tuitionbridge-demo-mock.mp4 (1:40, captions, no narration; .webm master is git-ignored from the package) · dist-submission/ (zip + tar.gz, git-ignored).

## Decisions
UI: guided demo (4 scenarios + more datasets), stepper, friendly errors, approval card focus. Login rate limit configurable (`APP_LOGIN_RATE_LIMIT`; e2e raises it). Deck numbers come from measured files and the policy code. Evidence = real runs read back from the DB (MOCK), plus a labeled REPLAY viewer.

## Remaining human blockers (details in SUBMISSION_CHECKLIST.md)
1. **LIVE model never run**: set key+model in `.env`, `npm run smoke:live`, then the bounded live eval; re-export evidence/deck.
2. No student interviews (deck slides 2 and 10 have TODOs).
3. AI_USAGE.md human-review section is blank; the team must read and understand money math, approval gate, tool loop, ledger transaction.
4. Narrated rehearsal not done; video is captions-only, MOCK.
5. Organizer questions unanswered: governing rubric, AI-code disclosure, final format/recording allowed, venue inference provider, under-18 rules, registration/submission channel (IEEE vs CMU emails differ).
6. Repository URL placeholder; project license not chosen; Node 24 and a teammate's machine untested.
7. Submit by 19 Oct; hard deadline 20 Oct 23:59 Beijing (20:59 Almaty).

## If resuming
Re-run `npm run test:summary && npm run eval && npm run evidence && npm run deck && npm run package` after any change; do not edit evidence by hand.
