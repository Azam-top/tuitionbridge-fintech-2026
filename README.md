# TuitionBridge

TuitionBridge helps international students compare tuition payment options against their deadline and living budget. Review the invoice, choose a plan, approve it, and complete the payment with the provider.

The app never moves money. You finish the payment with the provider, for example Wise. Wise quotes are preliminary and can change. For Wise, the totals come from the provider's own response, not from a displayed rate. The sandbox uses separate fictional test data.

## Requirements

- Node.js 24 or newer (tested on 26.11.1) and npm
- Google Chrome, for the browser tests only
- An AI model key, for the normal app only (the sandbox needs none)

## Install

```bash
npm ci
npm run build
```

## Run (one mode at a time)

Both modes use http://127.0.0.1:8787, so stop one before starting the other.

**Normal app** (your own data):

```bash
cp .env.example .env    # set APP_LLM_PROVIDER, APP_LLM_API_KEY and APP_LLM_MODEL
npm run start
```

**Sandbox** (test data, no key):

```bash
npm run start:sandbox
```

Sandbox sign-in: `alice@demo.local` / `demo-alice-2026` (or `bob@demo.local` / `demo-bob-2026`). Never commit `.env`.

## Use it

1. Enter your USD funds and the living reserve. Add your university's account from its official payment page.
2. Enter the invoice and confirm every field.
3. Choose lowest cost or fastest, then press **Plan my payment**. The server gets current Wise quotes. You can also add an offer from your bank.
4. Read the recommendation and the exact amounts, then approve.
5. Press **Continue on Wise** and pay there. Anything you mark or attach afterwards is your own record, not bank confirmation.

In the sandbox, pick a demo scenario, confirm, plan and approve. The payment is simulated.

## Checks

```bash
npm run typecheck
npm test
npm run test:e2e    # needs system Google Chrome
npm run eval        # 30 fixed cases on the sandbox
```

Real-model checks are recorded in `docs/LIVE_SMOKE_RESULT.md`. They are partial: one scripted run passed, one failed and was fixed, and the manual pass with a real invoice is not done.

## More

- `docs/ARCHITECTURE.md` and `docs/SECURITY.md`: how it works and how it is protected
- `docs/DEPENDENCIES.md`: dependency licenses
- `AI_USAGE.md`: how AI was used, in development and at run time
- `docs/deck/`: the presentation and its editable source
