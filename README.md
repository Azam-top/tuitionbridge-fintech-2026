# TuitionBridge

An assistant that helps an international student **choose and approve a tuition payment while protecting their living budget**. You give it a real invoice, a deadline and the USD you have; it compares payment options from named sources, prepares **one immutable proposal**, waits for **your explicit approval**, and then issues a **payment instruction**. Built for the 2026 Shenzhen International FinTech Competition, International Track, Topic C (USD→KZT tuition).

Repository: <https://github.com/Azam-top/tuitionbridge-fintech-2026>

## Two modes, kept apart

| | **LIVE** (default, the real application) | **SANDBOX** (competition check) |
|---|---|---|
| Users | you register; nothing is seeded | fictional test users (documented below) |
| Data | your own invoice, funds and recipients | fictional university, providers, balances |
| Model | a real model is **required**; without it the UI says *Setup required* and planning is disabled. There is no stand-in agent | the labeled **MOCK** stand-in works without a key |
| Payment options | Wise public quote endpoint (provider API) and offers **you enter** with source and time; NBK rate as a reference only | three fictional providers, labeled test data |
| After approval | the app issues a **payment instruction**; it **moves no money**. You pay in your bank or Wise | a simulated ledger executes the payment (**SIMULATED**) |
| Database | `data/live.sqlite` | `data/sandbox.sqlite` |

A database file is stamped with its mode; opening a live file in sandbox mode (or the reverse) is refused, so test data and real data cannot mix. The sandbox shows a banner and badges (`MODE: SANDBOX`, `PAYMENTS: SIMULATED`); the live screens show none: mode, model and run limits sit in a collapsed "Technical details" section.

## Install and run (local)

Requires Node ≥ 24 (developed and tested on Node 26.11; Node 24 not run). `better-sqlite3` is native; npm 12 blocks install scripts by default and `package.json` already allow-lists `better-sqlite3` and `esbuild` (if `npm install` still warns: `npm install-scripts approve better-sqlite3 esbuild`).

```bash
npm install
cp .env.example .env        # then set APP_LLM_PROVIDER, APP_LLM_API_KEY and APP_LLM_MODEL (yours; never commit .env)
npm run build
npm run start               # LIVE mode on http://127.0.0.1:8787 (loopback only)
npm run start:sandbox       # SANDBOX test data; no key needed
npm run check:sources       # read-only check of the real NBK and Wise sources
```

**Live walk-through:** register → *Set up* (declare your USD and the reserve to keep; add your university as a **trusted recipient** from its official payment page) → enter the invoice (or upload a text PDF) and confirm it → get **live Wise quotes** and/or enter an offer from your bank → *Plan my payment* → review the routes and where each offer came from → **Approve** → follow the **payment instruction** outside the app → optionally *mark paid* or upload your confirmation.

Sandbox test accounts (fictional, local only): `alice@demo.local` / `demo-alice-2026` and `bob@demo.local` / `demo-bob-2026`. The *Demo scenarios* panel resets and loads a scenario.

## Where every number comes from

| Data | Source | The UI says |
|---|---|---|
| Invoice fields | your document, **reviewed and confirmed by you** | "Confirmed by you" |
| Beneficiary | **a recipient you attested** from an official page (name, account, https address, note). Invoices cannot add or change one. An IBAN-shaped account must pass the mod-97 checksum | "Matched to a recipient you attested" |
| USD balance and reserve | **declared by you**; the app reads no bank | "declared by you" |
| Reference FX | National Bank of Kazakhstan RSS (`rates_all.xml`), stored with effective date, retrieval time and body hash | "reference, not an offer" |
| Wise options | Wise public quote endpoint (unauthenticated). Only currencies and the amount are sent. For each option the app stores Wise's own total, fee and recipient amount exactly (exact decimal to minor units, no recomputation from Wise's rounded displayed rate, no tolerance); malformed or wrong-currency options are dropped | "Provider API (live)", with rate type and expiry |
| Other offers | typed by you with a source note and the time you saw it; validity ≤ 7 days; a rate more than 25% from the NBK reference is refused as a probable typo | "Entered by you" |
| Fee, arrival, rate you did not provide | **unknown**; never replaced by a demo number | absent |
| Payment status | only your own marks and files | "not verified by a bank" |

## How money is handled

Money is BigInt minor units (USD cents, KZT tiyn) with integer strings on the wire. `principal = ceil(tuition / rate)`, `total = principal + fixed fee`; the recipient amount is rounded down from the rounded-up principal and the rounding surplus is shown. Only routes that are eligible, unexpired, arrive by the deadline and keep the reserve are ranked; the **server** chooses the best route for your stated objective (the model cannot pick a different one). The proposal is hashed (SHA-256) with its quote source; only you can approve it, and only that exact proposal. **The live mode never moves money**: it issues an instruction (recipient, account, total, rate, fee, validity, steps). A manual "I paid" mark or an uploaded PDF/PNG/JPEG is stored with its hash as *your own evidence*; the app never calls it verification. Real execution through a provider API is **not implemented** (it needs provider access, see `docs/REAL_USER_MODE_SOURCES.md`).

## Test, evaluate, export

| Command | What it does |
|---|---|
| `npm run typecheck` / `npm test` | strict type check; vitest (money, policy, security, agent, live mode with recorded real responses, HTTP, concurrency) |
| `npm run test:e2e` | Playwright with system Chrome: sandbox flows and the live mode (the model is a **local fake provider**, Wise/NBK off) |
| `npm run eval` | 30 fixed cases on the **sandbox** (MOCK + scripted drivers) → `artifacts/evidence/eval-mock.json` |
| `APP_EVAL_LIVE=1 npm run eval:live` | optional bounded real-model run (needs your key; spends credits; see `docs/LIVE_RUN.md`) |
| `npm run check:sources` | read-only check of the real NBK and Wise sources |
| `npm run test:summary`, `evidence`, `demo:capture`, `deck`, `licenses`, `package` | measured totals, evidence bundle, demo video, slides, dependency list, submission archive |

## Documents

`docs/ARCHITECTURE.md` · `docs/SECURITY.md` · `docs/PROJECT_SPEC.md` · `docs/REAL_USER_MODE_SOURCES.md` (which official sources and APIs exist) · `docs/LIVE_RUN.md` · `docs/DEMO_SCRIPT.md` · `docs/PITCH_QA.md` · `docs/deck/` · `AI_USAGE.md` · `docs/DEPENDENCIES.md` · `SUBMISSION_CHECKLIST.md` · `docs/HANDOFF.md`.

## Known limits (honest)

- **LIVE model not verified here** until you run it with your key (`docs/LIVE_RUN.md`); the adapter is tested against a local fake provider only.
- The app **does not execute real payments** and cannot see your bank; confirmation is your own evidence. No KYC/AML, no settlement, no provider contract.
- Wise's public quote is indicative: the received KZT amount is not guaranteed (`guaranteedTargetAmount: false`) and the endpoint is documented for Wise partners; check Wise's terms before relying on it. The deadline estimate is Wise's own.
- One currency pair (USD→KZT), fixed-fee offer model (enter a percentage fee as its USD total); text PDFs only (no OCR); English plus one tested Russian instruction.
- No student interviews yet; local security posture (loopback HTTP, single process, single SQLite file); the model provider's regional availability at the venue is unconfirmed.
