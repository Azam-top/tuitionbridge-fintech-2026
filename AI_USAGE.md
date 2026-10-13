# AI usage statement

Status: **draft for the team to confirm.** The organizers' rules on AI-assisted coding and disclosure were not found in the materials we checked; we are disclosing regardless and have asked (see SUBMISSION_CHECKLIST.md) for confirmation.

## Coding assistance
- Tool: Claude Code (Anthropic) in a VS Code environment, model Claude Sonnet 5.5, used on 12 October 2026 in two working phases ("Session 1": core build; "Session 2": evaluation, evidence, documents, deck and packaging).
- Generated with the assistant: the application source (`src/`), tests (`tests/`, `e2e/`), evaluation harness (`scripts/eval/`, `eval/cases.json`), evidence exporter and viewer, build/package scripts, and the drafts of the documents in `docs/`, `README.md` and the slide deck.
- Verification performed in those sessions (and recorded in `docs/HANDOFF.md` and the evidence bundle): type-check, unit/integration tests, browser tests in Google Chrome, mutation checks of security controls, and visual inspection of screenshots.
- **Human review:** `[TEAM TO COMPLETE: names, what each person reviewed (money algorithm, approval gate, tool loop, ledger transaction), date]`. Until this is filled in, the code should be treated as AI-generated and not yet human-reviewed. Do not describe it as reviewed.

## Runtime AI
- Default: **no model is called.** A deterministic MOCK agent (`src/server/agent/mock-llm.ts`) drives the same tools. It is labeled MOCK in the UI and in all evidence.
- Optional: an adapter for the Anthropic Messages API (`src/server/agent/anthropic-llm.ts`, official `@anthropic-ai/sdk`) activates only when `APP_LLM_API_KEY` and `APP_LLM_MODEL` are set. **It has not been verified against a live provider** in this repository. The model, if used, only selects tools and writes explanations; arithmetic, ranking, approval and ledger writes are deterministic code.
- Training/analysis data: none beyond synthetic fixtures.

## Other
- No third-party datasets, images, fonts or code snippets were copied in; dependencies and licenses are listed in `docs/DEPENDENCIES.md`.
- Student interviews/user research: **none collected yet.** Any problem statement in the deck is labeled a hypothesis.
