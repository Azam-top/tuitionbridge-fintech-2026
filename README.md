# TuitionBridge

A competition prototype (2026 Shenzhen International FinTech Competition, International Track, Topic C). An international student gives an agent a tuition invoice, a deadline, balances and a living-expense reserve. The agent compares three **simulated** USD→KZT routes, prepares a feasible payment, **waits for the student's approval**, then executes it in a local sandbox ledger and produces a receipt with tool-call evidence.

**Everything is synthetic.** Fictional university, fictional providers, fake accounts. No real money moves and no real bank or payment provider is contacted. The UI always shows `PAYMENTS: SIMULATED`, and `AGENT: MOCK` unless a model key is configured.

Repository: <https://github.com/Azam-top/tuitionbridge-fintech-2026>

## Install and run

Requires Node ≥ 24 (developed and tested on Node 26.11; Node 24 not run). `better-sqlite3` is a native module; npm 12 blocks install scripts by default, and `package.json` already allow-lists `better-sqlite3` and `esbuild`. If `npm install` still warns, run `npm install-scripts approve better-sqlite3 esbuild`.

```bash
npm install
npm run build          # builds the UI to dist/web
npm run start          # http://127.0.0.1:8787 (loopback only); seeds a demo DB on first run
```

Local demo accounts (synthetic, local only): `alice@demo.local` / `demo-alice-2026` and `bob@demo.local` / `demo-bob-2026`.

**Reset:** the "Guided demo" panel resets all demo data and loads a scenario (successful payment; cheapest route rejected for lateness; malicious invoice; insufficient funds; more under "More datasets"). From the terminal: `npm run reset-demo`. The deadline is always 48 h after a reset; quotes expire after 15 minutes (plan again for fresh quotes). `APP_DEMO_MODE=0` disables the reset endpoint.

Development: `npm run dev:server` and `npm run dev:web` (Vite proxies `/api`).

## Agent modes (runtime setup)

- **MOCK** (default): a deterministic stand-in drives the same tools, policies and database as the live adapter. It is labeled MOCK and reports no token usage. It is not a live model run.
- **LIVE**: copy `.env.example` to `.env` and set `APP_LLM_API_KEY` and `APP_LLM_MODEL` (server-only; `ANTHROPIC_API_KEY` is intentionally never read, so an exported key cannot switch other tools to API billing). Then `npm run smoke:live` for one bounded synthetic task (spends real credits). The badge reads `LIVE (unverified)` until a LIVE task with provider-reported usage exists in the database.

**LIVE MODE NOT VERIFIED in this repository.** The adapter (official `@anthropic-ai/sdk`, isolated behind an interface) is tested against a local fake provider only. The provider's regional availability may not cover the Shenzhen venue; an organizer-approved provider must be confirmed.

## Test, evaluate, export

| Command | What it does |
|---|---|
| `npm run typecheck` | TypeScript strict check |
| `npm test` | vitest: money, policy, security services, agent, HTTP, cross-process concurrency, adapter vs fake provider, invoice import |
| `npm run test:e2e` | Playwright browser flow with system Google Chrome (no browser download) |
| `npm run eval` | 30 fixed cases, deterministic (MOCK + scripted drivers) → `artifacts/evidence/eval-mock.json` |
| `APP_EVAL_LIVE=1 npm run eval:live -- --max-cases=6` | optional bounded real-model run of the model-driven cases (needs a key; spends credits) |
| `npm run test:summary` | runs type check + both suites and writes measured totals to `artifacts/evidence/test-summary.json` |
| `npm run evidence` | exports redacted evidence + the offline REPLAY viewer to `artifacts/evidence/` |
| `npm run demo:capture` | records the captioned demo video and slide screenshots from the real app |
| `npm run deck` | builds `docs/deck/index.html` and the PDFs from measured files |
| `npm run licenses` | writes `docs/DEPENDENCIES.md` |
| `npm run package` | allowlisted, secret-scanned submission archives in `dist-submission/` |

## Documents

`docs/ARCHITECTURE.md` (design and quote algorithm) · `docs/SECURITY.md` (permission tiers, controls, tested attacks, known limits) · `docs/PROJECT_SPEC.md` (contract and open organizer questions) · `docs/DEMO_SCRIPT.md` · `docs/PITCH_QA.md` · `docs/deck/` (slides, speaker notes, PDFs) · `AI_USAGE.md` · `docs/DEPENDENCIES.md` · `SUBMISSION_CHECKLIST.md` · `docs/HANDOFF.md`.

## What is in the box

- **Money:** BigInt minor units (USD cents, KZT tiyn); integer strings on the wire; exact decimal rates. `principal = ceil(tuition / rate)`, `total debit = principal + fixed fee`, recipient amount rounded down from the rounded-up principal; the rounding surplus is shown.
- **Route policy:** only routes that are eligible, unexpired, arrive by the deadline and leave the reserve intact are ranked; deterministic tie-breaking.
- **Security:** server sessions, CSRF + Origin checks, owner-scoped records, read/propose/execute tiers, SHA-256 proposal binding, human-only approval, single-transaction execution, idempotency keys, one payment per invoice, redacted audit log.
- **Agent:** bounded tool loop (8 tool calls, 10 model requests, 2 transient retries, token budget); the task pauses at `AWAITING_APPROVAL`; no model-callable approval.
- **Invoice input:** manual entry, a synthetic example, pasted text and text-based PDFs (no OCR). Extracted fields are a draft; ambiguity is never guessed.

## Known limits

Simulated payments only; one currency pair; no real provider integration; no OCR; English plus one tested Russian instruction; no student interviews yet; live model unverified; no KYC/AML; local-demo security posture (loopback HTTP, documented demo credentials). Open organizer questions (rubric, AI-disclosure, final format, inference provider, registration channel) are listed in `docs/PROJECT_SPEC.md` and `SUBMISSION_CHECKLIST.md`.
