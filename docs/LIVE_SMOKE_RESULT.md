# Real-model smoke test: result (one run)

**Verdict: PASS for this single bounded run. This is NOT a full verification of the LIVE mode.**

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

## Sources changed after this run

The package is built from `bb99c9eac52fb2654fe6641e3baa1b265bff24d6`. Between the smoke run (`b4e1ecd…`) and that commit the web interface changed and the live system prompt (`src/server/agent/runner.ts`) was extended with a required explanation (total and fee, timing against the deadline, reserve kept, why other options were excluded) and a rule not to state unknown fees or times. **This smoke run does not cover the new prompt.** A re-run needs your approval because it spends tokens on your Groq account.

## What this run does NOT establish

- The **five-case live evaluation** (`npm run eval:live`) was **not run**. `artifacts/evidence/eval-live.json` does not exist, and the real-model evaluation remains **NOT RUN**.
- A **manual pass with a real invoice** (own invoice, own recipient from the university's official page, own balance and reserve, personal approval in the browser) was **not done** with a real model.
- Behaviour under real rate limiting is not observed (no 429 occurred; retries were 0). The 429/timeout paths are tested only against a local fake provider.
- Other providers or models, and the Anthropic adapter against its real endpoint, were not exercised.
- One run is one sample. It shows the whole chain works once with this model; it says nothing about reliability, accuracy across invoices or adversarial inputs.

## Reproduce

Put `APP_LLM_PROVIDER=groq`, your key and `APP_LLM_MODEL=openai/gpt-oss-120b` in a local `.env`, then `npm run smoke:live`. It contacts Groq, Wise and the NBK feed and spends a few thousand tokens on your Groq account.
