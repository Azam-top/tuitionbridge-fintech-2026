# Real-model smoke tests: results

**Run 1 (2026-10-19, older sources): PASS. Run 2 (2026-10-20, the packaged sources): NOT PASSED.** The LIVE mode is not fully verified, and no real-model run has yet passed on the packaged sources. Run 2 is described first.

## Run 2: NOT PASSED (the packaged sources)

| Item | Value |
|---|---|
| Command | `npm run smoke:live`, run **once** by the repository script (stands in for the human; no person approved anything) |
| When | 2026-10-20 11:57:37 to 11:57:41 UTC (about 4 s) |
| Commit | `6c0d5b28e132b771df9ec60584a5cc5598cb2377`; the sources equal `bb99c9eac52fb2654fe6641e3baa1b265bff24d6` (no source change between them), tree clean |
| Provider, model | Groq, `openai/gpt-oss-120b`, provider-default endpoint, run within the free quota as instructed; no paid plan was connected |
| Data | synthetic student, university and invoice in memory (USD 1,500 balance, USD 300 reserve, KZT 500,000 invoice); Wise and NBK contacted for real |
| Outcome | task state `BLOCKED`, **no proposal, no instruction**; script verdict "did NOT pass" |

De-identified tool calls: `parse_invoice` ok, `get_balances` ok, `get_quotes` **ERROR `NO_OFFERS`**; the assistant then explained in 482 characters (accepted by the grounding check) and stopped. It invented no offer.

```json
{ "provider": "groq", "model": "openai/gpt-oss-120b", "state": "BLOCKED", "instructionIssued": false,
  "toolCalls": 3, "modelRequests": 4, "retries": 0, "usageReported": true,
  "inputTokens": 4920, "outputTokens": 429, "latencyMs": 1937, "error": null }
```

**Exact cause (found with two read-only follow-ups within a minute, not printed by the smoke script itself):** Wise answered, and the quote contained 19 payment options, but the app kept none. Wise's quote showed the rate rounded to three decimals (`450.295`). With it the app computes principal USD 1,110.39 (rounded up) plus Wise's fee, which is 1 cent more than Wise's own total for every option (for bank transfer: app 1,126.83 against Wise 1,126.82). The app's rule is to keep a Wise option only if its arithmetic reproduces Wise's total exactly, so every option was dropped and `get_quotes` returned `NO_OFFERS`. Run 1 passed because the rate of that quote happened to reproduce. This is a limitation of the app's strict check against Wise's rounded rate, not a model, key or quota failure. It is an inference for the smoke instance itself (its Wise note was not printed) and a direct observation for the follow-up quotes.

**Consequence:** with the sources as packaged, "Plan my payment" can intermittently find no usable Wise option and stop with a clear message; the workaround is to enter an offer from your bank. **Sources were frozen as instructed, so nothing was changed.** A fix would loosen a money-verification rule (accept a 1-cent difference caused by Wise's rate rounding) and needs a decision.

Not established by run 2: that the new system prompt (explanation of cost, timing, reserve and excluded options) works with a real model, because the run ended before a proposal existed.

**Follow-up (2026-10-20):** the Wise integration was changed in commit `f94f3a0` to store and use Wise's own total, fee and recipient amount for each option (no rebuild from the rounded rate, no tolerance). It was verified without any model: a regression on the rounding case, exact-amount, hash and tamper tests, and one fresh real Wise response taken through the whole path (`npm run check:sources`). **No real-model run has happened since**; the next one is a manual pass by a person (`docs/MANUAL_PASS.md`).

## Run 1 (2026-10-19, older sources): PASS, one run

**This is NOT a full verification of the LIVE mode.**

| Item | Value |
|---|---|
| Command | `npm run smoke:live` (the repository script, unchanged by the run) |
| Completed | 2026-10-19 11:02:47 UTC (16:02 Almaty). The run took about one minute |
| Source commit | `b4e1ecd510b751be4f714ddf838d3a3efaa30f37`, source tree clean, Node v26.11.1 |
| Model provider and model | Groq, `openai/gpt-oss-120b`, through the OpenAI-compatible endpoint `https://api.groq.com/openai/v1/chat/completions` (the script refuses to run if `APP_LLM_BASE_URL` overrides the endpoint) |
| Student, university, invoice | **Synthetic**, created in an in-memory database (USD 1,500.00 balance, USD 300.00 reserve, invoice KZT 500,000.00 due in 10 days). Your live database was not touched |
| Payment options | **Real**: three Wise public quotes for that amount fetched during the run (`PROVIDER_LIVE`), plus the NBK reference rate |
| Plan confirmation | **Done by the script**, standing in for the human click. No person approved anything in this run |
| Money | **No payment of any kind.** The app moves no money; the run ended with a payment *instruction* held in memory |

## Result (de-identified; ids masked, results shown by shape only)

| # | Tool | Outcome | Arguments |
|---|---|---|---|
| 4 | `parse_invoice` | ok | none |
| 5 | `get_balances` | ok | none |
| 6 | `get_quotes` | ok | none |
| 7 | `evaluate_routes` | ok | `preference=cheapest`, `reserve_usd_cents=30000` |
| 8 | `prepare_payment` | ok | `preference=cheapest`, one quote id, `reserve_usd_cents=30000` |

After the tools the model wrote an explanation (711 characters) that passed the grounding check against stored records.

```json
{
  "provider": "groq",
  "model": "openai/gpt-oss-120b",
  "state": "APPROVED",
  "instructionIssued": true,
  "toolCalls": 5,
  "modelRequests": 6,
  "retries": 0,
  "usageReported": true,
  "inputTokens": 9296,
  "outputTokens": 553,
  "latencyMs": 50688,
  "error": null
}
```

- Offers stored: Wise bank transfer, Wise credit card, Wise debit card (all `PROVIDER_LIVE`). The server chose Wise bank transfer, total USD 1,121.63. That figure is a live Wise quote of that minute and changes.
- Tokens are the provider-reported usage (9,849 in total). `latencyMs` is the sum of the model-request times as measured by the app, not wall time.
- The task state `APPROVED` means "approved and an instruction was issued". It does not mean a transfer happened.

## Sources changed after run 1

The package is built from `bb99c9eac52fb2654fe6641e3baa1b265bff24d6`. Between run 1 (`b4e1ecd…`) and that commit the web interface changed and the live system prompt (`src/server/agent/runner.ts`) was extended with a required explanation (total and fee, timing against the deadline, reserve kept, why other options were excluded) and a rule not to state unknown fees or times. **Run 1 does not cover the new prompt**, and run 2, which used it, did not reach a proposal (see above).

## What these runs do NOT establish

- The **five-case live evaluation** (`npm run eval:live`) was **not run**. `artifacts/evidence/eval-live.json` does not exist, and the real-model evaluation remains **NOT RUN**.
- A **manual pass with a real invoice** (own invoice, own recipient from the university's official page, own balance and reserve, personal approval in the browser) was **not done** with a real model.
- Behaviour under real rate limiting is not observed (no 429 occurred; retries were 0). The 429/timeout paths are tested only against a local fake provider.
- Other providers or models, and the Anthropic adapter against its real endpoint, were not exercised.
- One run is one sample. It shows the whole chain works once with this model; it says nothing about reliability, accuracy across invoices or adversarial inputs.

## Reproduce

Put `APP_LLM_PROVIDER=groq`, your key and `APP_LLM_MODEL=openai/gpt-oss-120b` in a local `.env`, then `npm run smoke:live`. It contacts Groq, Wise and the NBK feed and spends a few thousand tokens on your Groq account.
