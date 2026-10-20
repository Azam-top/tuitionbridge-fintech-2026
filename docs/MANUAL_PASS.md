# Manual pass with the real model (one run, done by the user in the browser)

**Status: NOT YET DONE.** This file is the procedure and the place where the result is recorded. Nothing below has been filled in by the assistant, and no result may be written here that the person who ran it did not report.

Why: the scripted smoke test (`docs/LIVE_SMOKE_RESULT.md`) stands in for the human click. This pass is the one in which a person confirms the plan.

## Before you start (about 2 minutes)
1. Stop any old server (Ctrl+C in its terminal): an instance started before commit `f94f3a0` still runs the old Wise code.
2. In the project folder: `npm run build && npm run start`, then open http://127.0.0.1:8787.
3. `.env` has `APP_LLM_PROVIDER=groq`, your key and `APP_LLM_MODEL=openai/gpt-oss-120b`. The pass uses the free quota; one plan costs roughly 10 thousand tokens. Do not repeat it automatically.
4. Use only an invoice and details you accept sharing with Groq (the confirmed invoice fields, the declared funds and the offers are sent to it).

## The pass
1. Register or sign in. Declare your USD and the reserve to keep. Add the university as a trusted recipient from its **official** page (https URL).
2. Enter your real invoice, check every field, confirm it.
3. Choose lowest cost or fastest and the reserve for this plan. Press **Plan my payment**. Do not add an offer by hand unless Wise fails.
4. Read the recommendation: total, fee, arrival against the deadline, reserve kept, the assistant's explanation, why the other options were excluded.
5. Approve it yourself (or reject it).
6. Read the payment instruction. The app moves no money. Do **not** pay for this test unless you really mean to pay the invoice.

## What to note (for the record below)
- Time and commit (`git rev-parse HEAD`).
- Did Wise quotes appear without typing anything? How many options, and does the proposal total equal the Wise total shown for that option?
- Did the plan finish, and how long did it take? Technical details (bottom of the page) show requests and tokens.
- Anything that looked wrong, in your words. Failures are as valuable as successes.

## Result (to be filled in from the person's report)
- Date, time, commit: _not recorded_
- Done by: _not recorded_
- Outcome: _not recorded_
