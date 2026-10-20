# AI usage statement

Status: **draft for the team to confirm.** The organizers' rules on AI-assisted coding and disclosure were not found in the materials we checked; we are disclosing regardless and have asked (see SUBMISSION_CHECKLIST.md) for confirmation.

## Coding assistance
Tool: Claude Code (Anthropic) in VS Code, model Claude Sonnet 5.5, used on 12 October 2026 and again from 18 to 20 October 2026. The work was done as a conversation: the project owner gave the instructions and the assistant produced and ran the work.

**Project owner (human)**
- Defined the task, the competition topic and the requirements, including what the product must never do (for example: move money, invent data, or let the AI approve a payment).
- Made the product and interface decisions: the separate live and sandbox modes, the choice of sources (Wise, the National Bank rate, bank offers typed in by the user), the dark interface and its wording, and the Wise hand-off.
- Decided when to run the real-model checks, what to publish, and what to submit.

**Claude Code**
- Generated most of the source code (`src/`), the tests (`tests/`, `e2e/`), the scripts (`scripts/`, evaluation cases, evidence exporter, packaging) and the first drafts of the documentation, README and presentation, following the owner's instructions.
- Proposed designs and wording for the owner to accept or change. It did not make product decisions on its own.

**Checks**
- Automated checks, run by the assistant and recorded in `docs/HANDOFF.md` and the evidence bundle: type check, unit and integration tests, browser tests in Google Chrome (with a local test model), and the 30-case sandbox evaluation. In an earlier session the assistant also broke security controls one at a time to confirm the tests catch it (not repeated since). Screenshots were inspected by the assistant.
- Checks by the owner: the owner ran the interface locally and reported what they saw (for example an inconsistent reserve figure on one screen, which was then fixed). A complete, recorded manual test of the interface is not documented, and the manual pass with a real invoice and a real model is not done (`docs/MANUAL_PASS.md`).

**Human review of the source code**
- A full human review of the source code is not documented. The code should be treated as AI-generated under the owner's direction and not yet fully human-reviewed. The money calculation, the approval gate, the tool loop and the ledger transaction are not recorded as reviewed by a person. The code was not written by hand.

## Runtime AI
- **Live mode (the real application) requires a real model** configured with `APP_LLM_PROVIDER` (`groq` or `anthropic`), `APP_LLM_API_KEY` and `APP_LLM_MODEL`; without them planning is disabled and the UI says setup is required. There is no automatic fallback to another provider, a paid API or the MOCK agent: a model failure is shown to the user with a retry. The confirmed invoice fields, declared funds, the offers (Wise quotes fetched by the server, or offers the student typed in), the chosen preference and reserve, and any free-text instruction are sent to the configured provider in that mode.
- **What the model does:** it calls the tools (read invoice, read balances, read offers, rank routes, prepare one proposal) and writes a plain-language explanation of the recommendation (cost, timing, reserve kept, why other options were excluded). **What it does not do:** arithmetic, ranking, choosing the route, approval or payment. The server computes and re-checks every amount, enforces the best route, and shows the model's wording only if its figures match the stored records; unknown fees or times must be stated as unknown.
- **Sandbox mode** (fictional test data): a deterministic MOCK agent (`src/server/agent/mock-llm.ts`) drives the same tools; it is labeled MOCK in the UI and in all evidence. It is never used in the live mode.
- Adapters: Groq through its OpenAI-compatible API (`src/server/agent/openai-compatible-llm.ts`, plain `fetch`) and the Anthropic Messages API (`src/server/agent/anthropic-llm.ts`, official `@anthropic-ai/sdk`). **Verification status, stated exactly:** the Groq adapter completed one real run on 2026-10-19 (model `openai/gpt-oss-120b`, synthetic student, real Wise quotes, plan confirmed by the script, no payment; `docs/LIVE_SMOKE_RESULT.md`). **That run used the system prompt as it was then.** The prompt was extended afterwards to require the explanation described above. A second real run on 2026-10-20 used the new prompt but **did not pass**: Wise's quote could not be reproduced to the cent, so no offer existed, the task ended `BLOCKED` without a proposal, and the explanation was not exercised (details in `docs/LIVE_SMOKE_RESULT.md`). The Anthropic adapter has not been verified against a live provider. The five-case live evaluation has not been run. Browser tests use a local fake provider.
- Training/analysis data: none beyond synthetic fixtures.

## Other
- No third-party datasets, images, fonts or code snippets were copied in; dependencies and licenses are listed in `docs/DEPENDENCIES.md`.
- Student interviews/user research: **none collected yet.** Any problem statement in the deck is labeled a hypothesis.
