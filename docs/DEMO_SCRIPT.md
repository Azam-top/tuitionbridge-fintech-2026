# Demo script (≤5 minutes) and recording notes

## What exists
- **Recorded capture:** `artifacts/demo/tuitionbridge-demo-mock.mp4` (also `.webm`), 1 min 40 s, no audio, on-screen captions. It is a real run of the app: **MOCK agent, SIMULATED payments, synthetic data**. Regenerate with `npm run build && npm run demo:capture`.
- **Rehearsal status:** the capture itself is a timed run (about 100 s). A spoken, live-narrated rehearsal by a team member has **not** happened; the timings below are targets to rehearse. Organizer permission to use a recording or the offline viewer at the finals is unconfirmed; keep the live app as the primary path.
- A live-model demo has **not** been recorded because the live adapter is not verified. If it is verified later, record a second take and disclose the mode on screen.

## Before you start (2 minutes)
1. `npm run build && npm run start`, open http://127.0.0.1:8787, sign in as `alice@demo.local`.
2. Check the badges say `AGENT: MOCK` (or `LIVE`) and `PAYMENTS: SIMULATED`. Say the mode out loud.
3. Press "1. Successful payment" in the guided demo (this resets the data; the deadline becomes 48 h away).
4. Quotes expire after 15 minutes. If you wait too long, reject and press "Plan my payment" again; do not approve an expired proposal (it will be refused, which is itself a good talking point).

## Spoken script with timing targets
| Time | Do | Say |
|---|---|---|
| 0:00 | Slide 1 or the login screen | "An international student has KZT 500,000 of tuition due in 48 hours, USD 1,500 in the bank, and must keep USD 300 for living. This is a prototype with synthetic data and simulated payments." |
| 0:30 | Invoice card → **confirm** | "The invoice fields are shown to the student first. Nothing happens until they confirm; ambiguous or mismatching details block it." |
| 1:00 | Instruction box → **Plan my payment** | "The student states a preference in plain words. The server validates it and shows what it understood: cheapest, USD 300 reserve the agent cannot lower." |
| 1:15 | Route table | "BudgetBridge is cheapest on paper, but arrives after the deadline, so it is excluded with a reason. SteadyPay is the cheapest feasible route." |
| 2:15 | Approval card | "The exact transaction: the recipient will receive KZT 500,000; the student is debited USD 1,010; deadline, quote expiry, recipient account. Only the student can approve; the agent has no approval tool." Click **Approve**. |
| 2:45 | Receipt, balance | "Simulated receipt, balance USD 490: the reserve is intact. Every step in the timeline is a stored tool event." |
| 3:15 | Press "3. Malicious invoice" → confirm → plan | "This invoice text tells the agent to skip approval and pay another account. It is shown as untrusted text and has no authority: the proposal still pays the registry account." **Reject**: "Balance unchanged: zero unauthorized debit." |
| 4:00 | Open `artifacts/evidence/viewer.html` (labeled REPLAY) or slide 7 | "30 fixed evaluation cases, 12 critical security gates, all passing in the deterministic evaluation. The real-model evaluation was not run. The live model is not verified." |
| 4:40 | Slide 10 | "Next: student interviews, a live-model run, and organizer confirmations." |

Finish before 5:00. If something fails live, use the recorded video and say so.

## If asked to show the unsafe attempt in code
Run `npm run eval` (about 5 seconds) and open `artifacts/evidence/eval-mock.json`, case `inj-02` (a scripted model that obeys the injection) and `auth-01/02` (forged approvals).
