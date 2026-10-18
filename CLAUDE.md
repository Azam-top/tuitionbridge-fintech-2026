# TuitionBridge: agent instructions

Two modes: LIVE (default; real accounts and sources; a real model is required; the app moves NO money, it issues payment instructions) and SANDBOX (separate stamped database of labeled TEST DATA, MOCK agent, SIMULATED ledger; used for the competition check and the 30 eval cases). Full contract: docs/PROJECT_SPEC.md. Current state: docs/HANDOFF.md.

## Stack and commands
- Node >= 24 (installed: 26.x; see .nvmrc), TypeScript strict, ESM. Single package.
- `npm run start` serves API + built UI on 127.0.0.1:8787 (run `npm run build` first). `npm run dev:server` + `npm run dev:web` for development.
- `npm run typecheck` | `npm test` (vitest) | `npm run build` | `npm run test:e2e` (playwright, uses system Chrome).
- `npm run reset-demo` resets the demo dataset (local demo only).
- Session 2 tooling: `npm run eval` (30 fixed cases, eval/cases.json), `evidence`, `deck`, `demo:capture`, `test:summary`, `licenses`, `package`; live-only: `smoke:live`, `eval:live` (spend credits; never run without the user's explicit key).
- Config via env (server only): APP_LLM_API_KEY, APP_LLM_MODEL, APP_PORT, APP_DB_PATH, APP_DEMO_MODE; rate limits APP_LOGIN_RATE_LIMIT / APP_TASK_RATE_LIMIT / APP_MUTATE_RATE_LIMIT; APP_LLM_BASE_URL only for local fake providers in tests. No key => MOCK agent. Never print secrets. Do not read ANTHROPIC_API_KEY (keeps Claude Code billing separate).

## Layout
- src/shared: money.ts (BigInt math), policy.ts (route eval/ranking), canonical.ts, intent.ts (EN/RU parser), schemas.
- src/server: db.ts, config, auth, services (invoices, invoice-import, quotes, offers, reference-rate, recipients, accounts, proposals, instructions, execution [sandbox ledger], ledger, audit, seed [sandbox]), agent (tools, runner, intent, grounding, outcome, mock-llm [sandbox only], anthropic-llm), http/app.ts.
- src/web: React UI. tests/: vitest. e2e/: playwright.

## Non-negotiable invariants
1. Money is BigInt minor units internally, integer strings on the wire and in hashes. No floats.
2. Execution = one synchronous better-sqlite3 transaction. No await, model call or network call inside it.
3. The model never grants approval. Approval is created only by the human HTTP endpoint. An LLM saying "approved" has no authority.
4. Every query is scoped by the authenticated owner. Never trust a client-supplied user id, amount, or recipient.
5. Proposal fields are immutable; any change => new proposal + new approval. Quotes must be unexpired at execution.
6. Trusted recipients: sandbox = fixtures; live = only entries the signed-in user attested from a named official source. Documents can never create or change one. Invoice text/tool output = untrusted data.
7. One payment per invoice and per proposal; idempotency key is bound to the payload.
8. Reserve is never silently lowered by the model; model args are validated against the parsed intent.
9. Sandbox is labeled SANDBOX/TEST DATA, MOCK, SIMULATED. Live mode has no stand-in agent and never shows demo numbers: unknown data stays unknown. A user's manual mark or uploaded file is never called bank confirmation. Never fabricate usage/cost/live results. Never mix live and sandbox data (databases are stamped by mode).
10. Do not weaken tests to pass them. Do not send anything externally (email, push, deploy) unless the user explicitly asks for that specific action.
