# Handoff (live mode and sandbox, 2026-10-18)

## State
The app now has two separate modes. **LIVE** (default): real accounts, your own invoice, a real model is required (no stand-in), payment options only from named sources (Wise public quote API, offers you type with source and time, NBK reference rate), and the app **moves no money**: it issues a payment instruction and stores your own evidence. **SANDBOX**: a separate stamped database of fictional TEST DATA with the MOCK agent and a SIMULATED ledger, used for the competition check and the 30 evaluation cases. See README for the table.

## Measured results (source commit `fe9a043f36b8a94533e2853728363311cf6bf74b`, clean tree, Node v26.11.1)
From `artifacts/evidence/test-summary.json`, `eval-mock.json`, `manifest.json`. The commit carrying these artifacts is a later one that changes artifacts and docs only; `npm run package` refuses unless the artifacts share one clean source commit and sources did not change since.
- Type check pass; unit/integration **183/183** (15 files); browser **22/22** (17 sandbox + 5 live, the live ones with a LOCAL FAKE model); production build pass.
- Deterministic evaluation on the **sandbox**: **30/30**, critical **12/12**, unauthorized payments **0**, gate PASS (MOCK + scripted drivers; says nothing about a real model).
- Demo video re-recorded at source commit `4bff48f` (the later commits only changed how the test config passes a placeholder credential; 2 min 44 s, captions only): LIVE segment with the local fake model and the real NBK/Wise sources, then the sandbox. Deck, screenshots, evidence viewer and `docs/DEPENDENCIES.md` regenerated.
- Real model: **LIVE NOT RUN**.

## What is real and verified
- **NBK reference rate** and **Wise public quote** (USD→KZT, KZT 500,000): fetched for real on 2026-10-18 by the app's own code (`npm run check:sources`). The app keeps a Wise option only if its arithmetic reproduces Wise's total to the cent. Recorded copies are in `tests/fixtures/*.recorded-2026-10-18.*` and are the only "real data" inputs in the tests.
- **Live flow in the browser** (register → funds → attested recipient → invoice → offer → plan → approve → instruction → user evidence) runs against the real Anthropic adapter, but with a **LOCAL FAKE provider** as the model (`e2e/fake-provider.ts`). That verifies the app, not a model.

## What is NOT done
- **Real model: LIVE NOT RUN.** Needs your key: `npm run smoke:live` (see `docs/LIVE_RUN.md`).
- **Real payment execution through a provider: not implemented.** Wise's documentation says a personal API token belongs to a Wise business account and exposes a subset of the API; whether it can create and fund USD→KZT transfers is unverified. Until access is confirmed the live mode issues an instruction and accepts user evidence. A manual mark or uploaded file is never called bank confirmation.
- Wise's public quote is indicative (`guaranteedTargetAmount: false`) and its endpoint is documented for Wise affiliate partners; read Wise's terms before relying on it (`APP_WISE_QUOTES=0` switches it off).
- No student interviews; human review section of `AI_USAGE.md` blank; no narrated rehearsal; Node 24 not run; organizer questions open (see SUBMISSION_CHECKLIST.md).

## Commands
`npm run build && npm run start` (live) · `npm run start:sandbox` · `npm run check:sources` · `npm run typecheck|test|test:e2e|eval|evidence|demo:capture|deck|licenses|package|test:summary` · `npm run smoke:live` (your key; spends credits).

## If resuming
After any source change: commit, then on the clean tree `npm run build && npm run test:summary && npm run evidence && npm run demo:capture && npm run deck && npm run licenses`, commit the artifacts, then `npm run package` (it refuses unless artifacts trace to one clean source commit). Do not edit evidence by hand.
