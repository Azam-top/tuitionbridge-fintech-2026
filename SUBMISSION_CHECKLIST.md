# Submission checklist

Deadline: **20 Oct 2026, 23:59 Beijing = 20:59 Almaty**. Recommended: submit on **19 Oct** and confirm receipt. Items marked **HUMAN** cannot be done by the code or the assistant. Nothing here has been emailed, registered, published or pushed.

## A. Deliverables in this repository
| Deliverable | Status | Where |
|---|---|---|
| Source, lockfile, setup | Done | `src/`, `package.json`, `package-lock.json`, `README.md`, `.nvmrc` |
| Tests | Done (see measured totals below) | `tests/`, `e2e/`, `npm test`, `npm run test:e2e` |
| Technical documentation | Done | `docs/ARCHITECTURE.md`, `docs/PROJECT_SPEC.md` |
| Security assessment | Done (self-assessment, not an audit) | `docs/SECURITY.md` |
| Sandbox logs / evidence | Done (MOCK agent, SIMULATED payments, redacted) | `artifacts/evidence/` (open `viewer.html`) |
| Evaluation (30 cases) | Done: deterministic only | `eval/cases.json`, `artifacts/evidence/eval-mock.json` |
| Pitch deck + speaker notes | Done | `docs/deck/index.html`, `docs/deck/TuitionBridge_pitch.pdf`, `..._with_notes.pdf` |
| Judge Q&A, demo script | Done | `docs/PITCH_QA.md`, `docs/DEMO_SCRIPT.md` |
| Demo video (≤5 min) | **Exists, with caveats**: 1 min 40 s, MOCK agent, captions, no narration | `artifacts/demo/tuitionbridge-demo-mock.mp4` |
| AI usage statement | Draft: **HUMAN must complete the review section** | `AI_USAGE.md` |
| Dependency licenses | Done | `docs/DEPENDENCIES.md` |
| Repository URL | Done (public) | <https://github.com/Azam-top/tuitionbridge-fintech-2026> |

Measured at packaging time: see `artifacts/evidence/test-summary.json` (type check, unit/integration, browser) and `eval-mock.json`. Re-run `npm run test:summary && npm run eval && npm run evidence && npm run deck` after any change.

## B. Missing or unverified (do not call the package "competition-ready" until these are resolved or consciously accepted)
1. **Live model run: NOT DONE.** Needs a legitimate key + model in `.env`, then `npm run smoke:live` (spends credits). Record the result in `docs/HANDOFF.md` and re-export evidence.
2. **Real-model evaluation: NOT DONE.** After the smoke test passes: `APP_EVAL_LIVE=1 npm run eval:live -- --max-cases=6`. Report it separately from the deterministic results.
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
