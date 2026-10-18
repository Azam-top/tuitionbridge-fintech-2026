# Demo script (≤5 minutes) and recording notes

## What exists
- **Recorded capture:** `artifacts/demo/tuitionbridge-demo-mock.mp4` (also `.webm`), about 3 min 40 s, no audio, on-screen captions. Two segments: (1) the **LIVE mode** with a **LOCAL FAKE model provider** (so it repeats without a key; the captions say it is not a real model) and the **real** NBK and Wise public sources; (2) the separate **SANDBOX** (fictional test data, MOCK agent, simulated ledger). Regenerate: `npm run build && npm run evidence && npm run demo:capture`.
- **Rehearsal status:** a spoken, narrated rehearsal by a team member has **not** happened; the timings are targets. Organizer permission to use a recording at the finals is unconfirmed; keep the live app as the primary path.
- A recording with a **real model** has not been made (it needs your key; see `docs/LIVE_RUN.md`). If you record one, say the mode on screen.

## Before you start (3 minutes)
1. Put your key in `.env` (`APP_LLM_API_KEY`, `APP_LLM_MODEL`), `npm run build && npm run start`, open http://127.0.0.1:8787. Badges must read `MODE: LIVE`, `AGENT: LIVE …`, `PAYMENTS: NOT MOVED BY APP`. Say the mode out loud.
2. Have your real invoice, your university's official payment page, and your bank's current offer ready. Only enter what you are comfortable sharing with the model provider (the invoice fields reach it).
3. Quotes expire (Wise ≈ 30 minutes). If you wait too long, plan again; an expired offer cannot become an instruction (a good talking point).

## Spoken script with timing targets (live mode)
| Time | Do | Say |
|---|---|---|
| 0:00 | Login screen | "TuitionBridge helps an international student choose and approve a tuition payment while protecting their living budget. This is the live mode: my account, my invoice, real sources. A separate sandbox of test data exists for the competition check." |
| 0:30 | Set up: funds and recipient | "I declare my USD and the reserve to keep; the app reads no bank. The university becomes a trusted recipient only because I add it from its official page. An invoice can never add one." |
| 1:15 | Invoice → confirm → offers | "I confirm the invoice fields. Options come from named sources: the Wise public quote API, or an offer I type from my bank with its source and time. The NBK rate is only a reference." |
| 2:00 | Plan my payment → approval card | "The agent reads these stored facts and proposes one route; the server, not the model, picks the best route for my preference. The card shows the exact recipient, amounts, reserve, and where the offer came from." Approve. |
| 3:00 | Instruction card | "The app does not move money. It issues a payment instruction. I pay in my bank or Wise. I can mark it paid or upload my confirmation: both are stored as my own evidence, never called bank verification." |
| 3:45 | Slide 7 or `viewer.html` | "30 fixed evaluation cases on the sandbox, 12 critical security gates, all passing. The real-model evaluation is run separately with my key." |
| 4:30 | Slide 10 | "Next: real execution through a provider once access exists, student interviews, organizer confirmations." |

Finish before 5:00. If something fails live, use the recorded video and say so.

## Sandbox (if the jury asks for the safe test data)
`npm run start:sandbox`, sign in as `alice@demo.local` (fictional), press the scenarios: 1 successful simulated payment, 2 cheapest route rejected for lateness, 3 malicious invoice (zero unauthorized debit), 4 insufficient funds. Run `npm run eval` for the 30 cases.
