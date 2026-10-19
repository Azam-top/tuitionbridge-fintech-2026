# Running the real model (human-triggered)

The live application needs a real model to plan at all (`APP_LLM_PROVIDER`, `APP_LLM_API_KEY`, `APP_LLM_MODEL` in `.env`). Two ways to verify it:

1. **`npm run smoke:live`**: one bounded task through the real model, the real Wise and NBK sources, on an in-memory database with one synthetic student. Prints the provider-reported usage. Your live database is untouched.
2. **The bounded pack below** (`eval:live`): five cases on the **sandbox** test data with the real model.

# Running the real-model evaluation (optional, human-triggered)

**Status in this repository: LIVE NOT RUN.** Nothing here has contacted a model provider. The adapter and every guard below were exercised only against a local fake provider and the MOCK agent.

A real run spends money on your provider account. It needs your own key and an explicit budget decision. Do not paste the key into a chat or a commit; put it only in a local `.env` (git-ignored) or the shell environment.

## 1. Configure locally

```
cp .env.example .env     # then edit .env
APP_LLM_PROVIDER=groq    # groq | anthropic (default anthropic)
APP_LLM_API_KEY=...      # your key; never printed by this project
APP_LLM_MODEL=openai/gpt-oss-120b   # the exact model id from your provider's current model list
```

Groq is reached through its OpenAI-compatible endpoint (`https://api.groq.com/openai/v1/chat/completions`) from the server only. The adapter does full tool calling (definitions, `tool_calls`, argument validation, execution, results back to the model) under the same loop limits. A 429 is retried at most twice and waits for the provider's `retry-after` (up to 30 s; a longer wait, such as a daily quota, fails the task visibly). There is no automatic switch to another provider, a paid API or the MOCK agent. Check your Groq plan's rate limits: a planning task sends the tool definitions with every request, so a small tokens-per-minute limit can slow or stop a run.

`ANTHROPIC_API_KEY` is intentionally never read. If your provider account sits in a region the venue cannot use, resolve that with the organizers first (see `SUBMISSION_CHECKLIST.md`).

## 2. Optional single smoke task

`npm run smoke:live` runs one synthetic task through the real adapter in the live mode (real Wise and NBK sources) and prints the state, request count and the usage the provider returned.

## 3. The bounded live pack

```
APP_EVAL_LIVE=1 npm run eval:live
# optional ceilings (defaults shown):
APP_EVAL_LIVE=1 npm run eval:live -- --max-total-tokens=120000 --case-timeout-seconds=180
```

The default pack `live-v1` (`eval/live-pack.json`) has five cases:

| Case | What it checks | Contacts the model? |
|---|---|---|
| live-01 | ordinary payment: cheapest route, approve, pay | yes |
| live-02 | conflicting reserves are refused by the server | no (rejected before any model call) |
| live-03 | prompt injection in the invoice notes; reject leaves the ledger untouched | yes |
| live-04 | cancel while the first model request is outstanding; late response is discarded | yes (one request) |
| live-05 | provider failure path on the real adapter class against an unreachable loopback port | no (no key is sent) |

Limits that always apply: 8 tool calls and 10 model requests per task, 2 transient retries, 40,000 tokens per task, a per-case wall-clock timeout, and a total token ceiling. When the total ceiling is reached the remaining cases are recorded as failed (`SKIPPED`), so the gate cannot pass on a partial run. `--report-only` records everything but never gates; a report-only run is never treated as verified.

The report is `artifacts/evidence/eval-live.json`. It stores per-case outcomes, provider-reported input/output tokens, request counts, latency, and a `provenance` block (driver, endpoint, source commit, whether the tree was dirty, parameters). It stores no key. Cost is **not computed**: multiply the reported tokens by your provider's current price list yourself, and quote only that.

## 4. When may the project say "real-model evaluation passed"?

Only if `assessLiveReport` returns `VERIFIED` (the deck and evidence export call it): kind `live-model`, agent mode LIVE, a model id, default provider endpoint (not a custom/fake one), provider-reported usage, every selected case passed with the release gate on, not report-only, clean source tree, and no source change since the run. Anything else is shown as `NOT VERIFIED` or `NOT RUN`. A failed live run must be reported as failed; there is no hidden fallback to MOCK.

## 5. After a run

```
npm run evidence && npm run deck && npm run package
```

Commit the new artifacts in a separate commit and record the source commit in `docs/HANDOFF.md`.
