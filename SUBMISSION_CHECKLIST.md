# Submission checklist

Deadline: **20 Oct 2026, 23:59 Beijing = 20:59 Almaty**. Recommended: submit on **19 Oct** and confirm receipt. Items marked **HUMAN** cannot be done by the code or the assistant. Nothing here has been emailed, registered, published or pushed.

## A. Deliverables in this repository
| Deliverable | Status | Where |
|---|---|---|
| Source, lockfile, setup | Done | `src/`, `package.json`, `package-lock.json`, `README.md`, `.nvmrc` |
| Tests | Done (see measured totals below) | `tests/`, `e2e/`, `npm test`, `npm run test:e2e` |
| Technical documentation | Done | `docs/ARCHITECTURE.md`, `docs/PROJECT_SPEC.md` |
| Security assessment | Done (self-assessment, not an audit) | `docs/SECURITY.md` |
| Sandbox logs / evidence | Done (sandbox: MOCK agent, SIMULATED payments, redacted) | `artifacts/evidence/` (open `viewer.html`) |
| Evaluation (30 cases) | Done: deterministic, on the **sandbox** test data | `eval/cases.json`, `artifacts/evidence/eval-mock.json` |
| Pitch deck + speaker notes | Done | `docs/deck/index.html`, `docs/deck/TuitionBridge_pitch.pdf`, `..._with_notes.pdf` |
| Judge Q&A, demo script | Done | `docs/PITCH_QA.md`, `docs/DEMO_SCRIPT.md` |
| Demo video (≤5 min) | **Exists, with caveats**: re-recorded 2026-10-18; LIVE segment uses a LOCAL FAKE model provider (captioned) and the real NBK/Wise sources; SANDBOX segment; MOCK/fake model, captions only, no narration | `artifacts/demo/tuitionbridge-demo-mock.mp4` |
| AI usage statement | Draft: **HUMAN must complete the review section** | `AI_USAGE.md` |
| Dependency licenses | Done | `docs/DEPENDENCIES.md` |
| Repository URL | Done (public) | <https://github.com/Azam-top/tuitionbridge-fintech-2026> |

Measured at packaging time: see `artifacts/evidence/test-summary.json` (type check, unit/integration, browser) and `eval-mock.json`. Re-run `npm run test:summary && npm run eval && npm run evidence && npm run deck` after any change.

## B. Missing or unverified (do not call the package "competition-ready" until these are resolved or consciously accepted)
1. **Real-model smoke: PASS, one run (Groq `openai/gpt-oss-120b`, 2026-10-19 11:02 UTC, source `b4e1ecd510b751be4f714ddf838d3a3efaa30f37`).** The student, university and invoice were synthetic; the Wise quotes were real; the plan was confirmed by the script, not by a person; **no payment happened**. Usage: 6 model requests, 5 tool calls, 0 retries, 9,296 input / 553 output tokens, 50.7 s of model time. Details and limits: `docs/LIVE_SMOKE_RESULT.md`. **The packaged sources (`bb99c9eac52fb2654fe6641e3baa1b265bff24d6`) are newer than the smoke run: the web interface and the live system prompt changed afterwards and the smoke was not re-run on them.** **This does not make the LIVE mode fully verified**: the five-case live evaluation (item 2) and a manual pass with your real invoice (item 1b) are still open.
1a. **Real payment execution: NOT IMPLEMENTED.** The live mode issues an instruction and stores your own evidence; it needs confirmed provider access (e.g. a verified Wise business account and API token) before the app can create transfers.
1b. **Your real data: NOT DONE with a real model.** Declare your funds, add your university's official payment details as a trusted recipient, enter your real invoice, check the extracted fields, review the live Wise offers, approve the plan yourself, then pay at the provider's own site following the instruction. The browser flow is tested only with a local fake model.
2. **Real-model evaluation: NOT DONE** (the smoke test above is one run, not this evaluation; `artifacts/evidence/eval-live.json` does not exist). Run: `APP_EVAL_LIVE=1 npm run eval:live` (five-case pack, token/time ceilings). Report it separately from the deterministic results; failures are reported as failures.
3. **Student evidence: NOT COLLECTED.** 5–10 consented, anonymized interviews; replace the TODOs on deck slides 2 and 10 with real counts. No banking or passport documents in the repository.
4. **Human code review: NOT RECORDED.** The money algorithm, approval gate, tool loop and ledger transaction must be read and understood by the team; fill in `AI_USAGE.md`.
5. **Narrated demo / rehearsal: NOT DONE.** The recording has captions only. Rehearse the spoken script in `docs/DEMO_SCRIPT.md` aloud with timing (≤5 min; deck ≤10 min).
6. **Fresh-machine install test: NOT DONE on a teammate's machine.** Verified locally from an extracted package (see HANDOFF). Node 24 LTS was never run (developed on Node 26).
7. **Project license:** not chosen.

## C. Registration and organizer questions (HUMAN)
- Registration deadline **20 Oct 2026 23:59 Beijing**; IEEE notes registration may close early.
- Eligibility: full-time university students outside Mainland China, Hong Kong, Macao and Chinese Taipei; teams of 2–5; at least 60% non-Chinese nationals; one team per person; English. **Confirm each member's eligibility, including any under-18 participation and travel rules.**
- Contacts differ between notices: IEEE CIS Singapore lists `fintechathon@ican-x.com` with subject `International Track Registration – [Lead Country] – [Team Name] – [Team Leader’s Full Name]` (confirmation expected within 48 h); the CMU notice and the track brief list `wangyr@pbcsf.tsinghua.edu.cn` and ask for the registration form and passport bio pages. **Confirm the correct registration and submission channel directly.** Keep passport files out of the repository and the package.
- Questions to send:
  1. Which rubric governs: the International Track brief (task completion 40 / security and compliance 30 / innovation and interaction 30) or the general site (implementation completeness / innovation / business value)?
  2. Is AI-assisted coding allowed, and is disclosure required (we include `AI_USAGE.md`)?
  3. What is the final defense format on 22 November, and may a recorded or offline demo be used as a backup?
  4. Is an inference provider approved or provided for the venue (the provider we adapted is not supported in mainland China)?
  5. Are under-18 team members permitted, and what are the travel/guardian requirements?
  6. How and where is the submission delivered, and how is receipt confirmed?
- Verify every submitted file opens, and confirm receipt before the deadline.

## D. Final packaging
`npm run build && npm run test:summary && npm run eval && npm run evidence && npm run deck && npm run package`. The package script uses an allowlist, scans for secrets, and writes `dist-submission/*.tar.gz` and `*.zip` plus `CONTENTS.txt`. It excludes `node_modules`, databases, `.env`, build and test output.
