# TuitionBridge: research and two Claude Code sessions

Prepared for Azamjon, 11 October 2026. Topic C, 2026 Shenzhen International FinTech Competition, International Track.

This is an implementation brief for a competition prototype. Build estimates, evaluation thresholds, and product positioning are our recommendations, not organizer scoring promises or measured results.

## The decision

Build **TuitionBridge**: an international student gives the agent a tuition invoice, a deadline, balances, and a living-expense reserve. The agent compares three simulated payment routes, prepares a feasible payment, waits for the student's approval, then executes it in a persistent sandbox ledger and produces a receipt with tool-call evidence.

Use one currency pair, USD to KZT, and a fictional university. This is manageable because quotation, payment, and recipient services are controlled fixtures. A currency pair does not establish an actual supported sending-country corridor. Real provider integration, OCR for scanned documents, and production financial authorization would substantially increase the work.

The strongest demo is one completed payment plus one visibly blocked unsafe attempt. The distinguishing hypothesis is that students need help preserving living funds, meeting deadlines, checking recipients, and understanding total cost. Validate that hypothesis with actual students; do not claim that existing tuition-payment providers lack these capabilities.

## What further research established

### Judging and practical preparation

The International Track brief publishes this rubric [R1]:

| Criterion | Weight | Evidence to prepare |
|---|---:|---|
| Task completion | 40% | Agent tool calls, approval, ledger change, receipt |
| Security and compliance | 30% | Tested authorization, expiry, ownership, duplicate prevention |
| Innovation and interaction | 30% | Student problem, reserve-aware choices, clear explanations |

The evidence column is our preparation advice. No finer International Track point breakdown or public judge score sheets were located in the sources checked.

There is a discrepancy: the general 2026 website's Rules section instead labels its AI rubric implementation completeness / innovation / business value, also 40 / 30 / 30 [R3]. Use the track-specific brief as the working basis and ask the organizer which version governs your entry.

IEEE CIS Singapore describes this as the first International Track [R2]. Previous domestic winners provide preparation clues rather than a directly comparable winning formula:

- A 2025 HKUST Guangzhou third-prize participant described identifying tedious financial entry and rigid feedback, then shifting attention from algorithms to product delivery. The same university's first-prize project already had earlier competition and industry experience [R4]. These accounts support focusing on a concrete workflow; they do not show that a short AI-built prototype can match a mature research project.
- The 2025 second-prize AI4Fin team reported a 36-hour final hackathon and emphasized integration, presentation practice, and time control [R5]. The current official International schedule lists an on-site defense on 22 November [R3]. Confirm the final format instead of assuming the older domestic hackathon applies.

Submission evidence should cover technical documentation, a deck for a presentation of at most ten minutes, source/setup/tests, a security assessment, and sandbox logs. The brief calls video optional in one box but asks for it under non-chain execution evidence: prepare a video under five minutes [R1].

### Registration and unresolved rules

- Deadline: **20 October 2026, 23:59 Beijing = 20:59 Almaty**. Aim to submit on 19 October.
- Eligibility: full-time university students at institutions outside Mainland China, Hong Kong, Macao, and Chinese Taipei; teams of 2–5; at least 60% non-Chinese nationals. One team per person. English submission and defense [R2].
- IEEE's notice warns that registration may close early. It gives **fintechathon@ican-x.com**, with subject `International Track Registration – [Lead Country] – [Team Name] – [Team Leader’s Full Name]`, and an expected confirmation within 48 hours [R2].
- CMU's notice and the International brief give **wangyr@pbcsf.tsinghua.edu.cn**. CMU requests the registration form and passport bio pages [R1, R6]. Confirm your registration and submission channel directly; keep passport files outside the project repository.
- No explicit AI code-generation permission or disclosure clause was located in the accessible materials. Independence and licensed components are required [R1, R3]. Ask about coding-assistant use and disclosure, under-18 participation/travel if applicable, the governing rubric, the final defense format, and an approved inference provider for Shenzhen.

This document creates no registration, email, deployment, or payment. Those remain human actions.

### AI access, limits, and evidence

Claude Code and Claude chat share five-hour and weekly subscription limits; VS Code uses the same allowance [R7]. Two logical work sessions do not guarantee two uninterrupted quota windows. A new conversation does not replenish that allowance. Keep checkpoints so a quota interruption does not restart work.

For an eligible Claude user, a practical choice is `opusplan` for planning with Opus and implementation with Sonnet, or Sonnet throughout if capacity is tight. Use Opus selectively for approval/ledger review. These are workflow recommendations; official model aliases change and availability depends on the account/provider [R8]. Avoid choosing the most expensive model for every edit.

The prompts use concise persistent project files, explicit verification, and a bounded scope, following Claude Code's documented workflow advice [R9]. Session 2 reads the handoff instead of receiving the entire first prompt again. No default agent swarm, repeated repository dumps, or dependency-heavy features are needed.

The application's inference credentials and budget are separate from the coding subscription. Use project-local runtime configuration so an exported API key does not accidentally switch Claude Code itself to API billing [R7]. The prototype should have a transparent mock mode and a real model adapter; measure actual live runs separately.

Anthropic currently lists Kazakhstan as supported and mainland China as unsupported, including use while physically there [R10]. For the Shenzhen final, confirm an organizer-approved, supported inference service. Preserve an isolated adapter, a genuine recorded run, and a labeled offline evidence viewer. Those backups do not establish permission to replace a required live demo.

Coding assistance can leave transcripts, generated files, and Git history. Keep an honest `AI_USAGE.md` describing tools, reviewed work, and tests. Never manufacture authorship, interviews, partnerships, performance figures, or payment evidence. Since you are currently 17, the Claude-compatible prompts are for an eligible teammate's own account; you can use the same engineering brief with Codex yourself, as discussed previously.

## How to use the two sessions

1. Open the intended project folder in VS Code. Install the official Claude Code extension, sign in with an eligible account, and review its edit permissions [R11].
2. Copy only the **Session 1** block below into Claude Code. If using Plan mode, approve the concrete plan so implementation starts.
3. Let Session 1 reach its completion gate. If interrupted by context or usage limits, resume that phase with: `Read CLAUDE.md and docs/HANDOFF.md. Continue Session 1 from its recorded checkpoint and finish its completion gate.`
4. Start a fresh conversation in the same folder and paste only **Session 2**. The durable specification and handoff carry the details forward.

These are two engineering phases. A phase can span several resumed conversations if quota, debugging, or missing credentials requires it. Session 1 includes working UI and core tests; Session 2 includes additional evaluation and presentation work. The previous 5–7 day prototype estimate is a planning estimate, not a promise that all work fits two messages.

## Session 1 — build the complete, verified core

Copy everything inside this block:

```text
You are implementing TuitionBridge, a competition prototype for Topic C of the 2026 Shenzhen International FinTech Competition's International Track. Work in this VS Code project. Deliver working code and verification, not just a plan. Preserve existing user work and inspect repository instructions, Git status, and package files first. Reuse compatible existing patterns; scaffold only if needed.

MISSION AND COMPETITION CONTEXT
TuitionBridge helps an international student fund tuition while retaining living funds. Complete one task: confirmed invoice -> balances -> three sandbox payment quotes -> feasible route selection -> immutable payment proposal -> explicit human approval -> agent-executed sandbox payment -> receipt and redacted execution evidence.

The International brief's rubric is task completion 40%, security/compliance 30%, innovation/interaction 30%. English is required. Submission deadline is 20 October 2026, 23:59 Beijing (20:59 Almaty). Required preparation includes technical/security documentation, source/README/tests, presentation <=10 minutes, and sandbox logs plus a <=5 minute demo. The general website's rubric labels differ; organizer confirmation is pending. AI-assisted coding disclosure, final format, and a supported Shenzhen inference provider also need human confirmation. Do not claim these questions are resolved or send anything externally.

PRODUCT SCOPE
Use fictional university/provider identities and synthetic data. USD funding and KZT tuition only. Show balances in both currencies and keep per-currency reserves explicit; never add currency amounts together without a defined conversion. Existing KZT funds remain untouched in this prototype's USD-funded payment flow. Explain this limitation.

Support manual/structured invoice entry and at least one synthetic example. A text-based PDF parser is optional in this phase; scanned-image OCR is outside the core. Invoice fields: reference, recipient registry ID, beneficiary name/account, KZT amount, due timestamp, source type. Display extracted/entered fields for human confirmation before planning. Ambiguity, missing fields, and a trusted-recipient mismatch must produce a recoverable blocked state. Do not guess bank details. Allow corrections, then revalidate and reconfirm.

Provide a natural-language task box: for example, “Pay this invoice by its deadline, use the cheapest feasible route, and keep USD 300 for living costs.” Also accept “prefer faster arrival.” Support an English interface and test an equivalent Russian instruction as an optional multilingual input; do not claim broad language support without testing. Validate the structured intent and show the understood constraints before a proposal can be approved. The model cannot silently lower a confirmed reserve or change a deadline/beneficiary.

ARCHITECTURE
Prefer a small React/TypeScript frontend, Node/TypeScript server, SQLite, schema validation, and exact decimal/minor-unit money calculations. Choose maintained versions compatible with the installed runtime and lock dependencies. Use a small number of libraries. Reuse an existing sensible stack if changing it would waste work. No microservices, blockchain, native app, cloud auth dependency, real bank connection, or payment checkout.

Separate pure money/policy functions, persistence, agent orchestration, provider adapter, HTTP authorization, and UI. Define shared schemas at the boundary. Persist users, sessions, invoices, quotes, proposals, approvals, agent tasks, payments, and structured audit events. Inject the clock for reproducible expiry/deadline tests. Keep fixtures in versioned files; generate dates relative to the seeded demo clock or a documented reset so the app does not expire accidentally tomorrow.

AGENT IMPLEMENTATION
Implement one real inference-provider adapter with its official SDK and documented tool-calling API. Reuse a configured supported provider if one exists; otherwise use a clearly documented Anthropic adapter for development in a supported region. Verify the current API shape in official docs rather than inventing SDK methods or model IDs. Keep the model name in server-only configuration. Isolate the adapter so an organizer-supported alternative can later replace it. Do not route around a provider's region restrictions.

Use project-local server configuration such as APP_LLM_API_KEY and APP_LLM_MODEL; pass the key explicitly to the SDK. Never expose or print secrets. Distinguish three user-visible facts: the agent model is LIVE or MOCK; all payment execution is SIMULATED; an offline record is a REPLAY. A missing key must allow deterministic mock runs using the same tools, policies, and database. Mock mode must never be presented as a verified live model run.

Provide tools equivalent to parse_invoice, get_balances, get_quotes, evaluate_routes, prepare_payment, and execute_sandbox_payment. The real model must select tools through a bounded loop, interpret user preferences, handle ambiguity, and explain facts returned by tools. Arithmetic and authorization belong to deterministic server code. Render actual structured tool events rather than generated claims about actions. Do not expose or log hidden chain-of-thought.

Pause the persisted agent task at AWAITING_APPROVAL after preparation. There is no model-callable tool that grants approval. A human approval endpoint resumes the task; only then may the execution tool be exposed. Every execution entry point still checks the same server authorization policy. An LLM sentence saying “approved” must have no authority.

Initial engineering limits: one active task per user; maximum 8 tool calls and 10 model requests across the task's pre/post-approval phases, including retries; tool timeouts; at most 2 transient retries within those totals; a configurable output-token limit and conservative per-task token budget. Leave enough model rounds for tool results and the post-approval execution. Fail visibly when a limit is reached. Retry side effects with the original idempotency key. Record actual token use, latency, tool counts, and outcomes when available. Do not fabricate unavailable usage/cost data or repeatedly call the model to polish prose.

QUOTE AND MONEY CONTRACT
Seed three fictitious quote providers with different fee/arrival tradeoffs: a cheap route that can miss the deadline, an on-time mid-price route, and a faster costly route. Add fixtures where the cheapest route is feasible, none is feasible, and funds are insufficient. Every quote declares simulated provenance, source/destination currencies, KZT per USD rate, fixed USD sender fee, recipient amount, issue/expiry time, eligibility, and estimated arrival. Fixture arrival times are estimates, not guarantees.

Use positive integer cents for USD and tiyn for KZT, with an exact decimal rate representation. Sender principal USD = the tuition amount divided by the quote rate, rounded upward to a USD cent. Total debit = sender principal + the stated fixed USD fee. Calculate recipient funds from that rounded principal without overstating delivery, and ensure they cover tuition. Test rounding with non-trivial rates. The quote rate already defines conversion; do not charge a second invented FX margin. Reject invalid/negative values, unsupported pairs, out-of-range amounts, and expired quotes.

Only rank routes that are eligible, unexpired, arrive by the confirmed deadline, and leave the USD reserve intact after the total debit. Use deterministic sorting: lowest debit first for cheapest preference, earliest arrival first for faster preference, then stable tie breakers. Explain excluded routes using factual reasons. If nothing qualifies, do not propose a payment. A reference FX rate is not an executable quote. Display source debit, fee, destination amount, reserve after payment, arrival, and expiry with correct units.

Reference demo fixture, entirely synthetic: tuition KZT 500,000; USD balance 1,500; USD reserve 300; deadline T+48h. Quote B: rate 505, fee USD 5, arrival T+72h, total USD 995.10, excluded as late. Quote C: rate 500, fee USD 10, arrival T+24h, total USD 1,010.00, leaving USD 490.00. Quote A: rate 495, fee USD 15, arrival T+6h, total USD 1,025.11. Cheapest-feasible selects C; faster preference selects A. Check these expected results independently and display any recipient rounding surplus accurately. All quotes must still be unexpired and eligible at execution.

SECURITY AND LEDGER CONTRACT
Implement actual server-side sessions and ownership, not a client-supplied user ID. Seed two demo accounts with hashed passwords; use opaque HttpOnly/SameSite cookies, appropriate CSRF/Origin protections for mutations, narrow CORS or same-origin hosting, validation, and basic abuse limits. Document local-demo credentials and defaults. Scope every invoice, proposal, task, approval, payment, and log to its authenticated owner. Use read/propose/execute permission tiers enforced by the server.

An immutable proposal must bind owner, invoice, recipient, currencies, amount, principal, fee, rate, quote ID/version, arrival/deadline, reserves, and expiry. Canonicalize and hash critical fields. Approval is a server-created record tied to that proposal/hash and owner, with an expiry. Modifying or refreshing critical fields requires a new proposal and approval. Reject client amounts/recipients that disagree with authoritative records. Require the trusted fixture beneficiary to match; uploaded documents cannot update that registry.

Execute in one database transaction: recheck ownership, permission, approval validity, quote freshness, invoice unpaid status, current balance and reserve; create payment/receipt, debit the USD ledger, credit the synthetic university KZT ledger, mark the invoice paid, and consume approval atomically. Quote refresh or insufficient funds fails without partial mutation. State the simulated conversion and fee treatment clearly, including any rounding remainder.

Use a unique idempotency key bound to an execution payload: same-key retry returns the original receipt, same key with conflicting payload fails. Also enforce invoice/payment uniqueness so a second key or proposal cannot pay the same invoice twice. Handle concurrent execution and competing payments safely against current balances. Record rejection events without creating a successful-payment event.

Treat invoice text and tool outputs as untrusted data. Instructions inside an invoice cannot waive approval, reveal secrets, replace the beneficiary, or change tool permissions. Bound input/file sizes and validate schemas. If you implement uploads, limit supported types and parse errors safely. Audit only redacted structured fields, event time, task/model/mode, policy result, proposal/approval/payment references, and measured usage. Exclude raw credentials and unnecessary personal data.

FUNCTIONAL UI IN THIS SESSION
Build usable screens/components for login, balances/reserves, invoice confirmation, understood intent, quote comparison, task/tool timeline, approval, blocked/retry states, and receipt. Approval shows the exact transaction before the user acts. Prevent accidental double-click execution, while treating server enforcement as authoritative. Show live database results, loading/errors, and clear labels for simulation/model mode. Bind to loopback by default and include an authenticated resettable demo dataset restricted to explicit local demo operation. Do not hide a failed tool call behind a success toast.

VERIFICATION
Write meaningful deterministic tests for the financial and authorization boundaries, plus a browser test of the completed flow. Cover: correct rounding and fee-inclusive debit; cheapest feasible and faster selection; late/unsupported/expired routes; no quote; insufficient funds and reserve preservation; ambiguous invoice; trusted-recipient mismatch; execution without approval; forged/text-only approval; changed critical fields; expired approval; cross-user access; same/different-key duplicates; concurrent execution and competing debits; malicious invoice instructions; provider failure/retry limits. Check actual database effects, not just response text. Use unit/integration tests plus a small Playwright suite or an existing equivalent.

Run type checks, the relevant tests, and a production build. Inspect the app in a browser if tools are available. With a deliberately configured runtime key and model, run one bounded live-agent smoke test using synthetic data; otherwise state LIVE MODE NOT VERIFIED and provide the exact setup step. Do not switch billing accounts, purchase credits, or search the machine for keys. Do not weaken valid tests to pass or report checks you did not run.

CONTEXT AND HANDOFF
Before substantial coding, persist docs/PROJECT_SPEC.md (<=1,500 words) with these contracts, competition facts/unknowns, and phase gates. Create CLAUDE.md (<=120 lines) containing stable commands, paths, and non-negotiable financial/security invariants, and pointing to the spec. Keep docs/HANDOFF.md (<=600 words) updated after milestones: what works, exact paths/commands, tests actually run, live vs mock status, decisions, remaining blockers, and Session 2 checklist. Keep secrets out. Avoid duplicating the complete prompt in several files.

Use a short plan, then implement in dependent milestones. Search with targeted file reads; avoid repository dumps, repeated broad research, installing speculative features, or default parallel agents. Fix failures before broadening scope. Use small local commits if the project already has Git; never push or discard unrelated changes. If approaching context limits, update the handoff and checkpoint before continuing.

SESSION 1 COMPLETION GATE
The core flow persists real sandbox ledger changes after human approval. Deterministic financial/security tests and the browser flow pass, type checks/build pass, a working real provider adapter exists, and live verification status is honestly recorded. No security invariant is deferred as “polish.” Missing external credentials may remain a named human blocker; mock mode and all non-live checks must still work. If core blockers remain, continue Session 1 rather than prematurely declaring it finished.

Finish with the run command, a concise actual verification summary, unresolved blockers, and confirmation that the specification/handoff are current. Session 2 will complete evaluation, interface polish, evidence, and submission materials. Begin now.
```

## Session 2 — finish evaluation, presentation, and submission

Copy everything inside this block into a fresh conversation in the same project:

```text
Finish TuitionBridge's second phase in this existing repository. First read repository instructions, CLAUDE.md, docs/PROJECT_SPEC.md, and docs/HANDOFF.md; inspect Git status and the relevant changes. These files carry the full Session 1 contract. Preserve user work and the financial/security invariants. Implement and verify the following work, rather than returning only advice.

1. Check the Session 1 gate and close actual blockers first. Run the documented relevant checks. Reuse the architecture and tools; refactor only to fix a demonstrated defect. If runtime credentials are missing, keep working on all independent items and label live inference unverified. Do not change billing or source secrets from outside project configuration.

2. Polish the functioning UI for an English-speaking student and judges: clear hierarchy, readable money/units, restrained ink/teal colors, responsive layout, keyboard operation, visible focus, helpful errors, and clear confirmation. Keep exact source debit/fee/destination/reserve/deadline/expiry on approval. Every number/status comes from the actual server. Add a guided demo with three resettable scenarios: successful affordable payment; cheapest route rejected for lateness; malicious invoice instructions blocked with zero unauthorized debit. Add a straightforward insufficient-funds example if already available. Preserve clear LIVE/MOCK, SIMULATED PAYMENT, and REPLAY labels. A mismatch is not a proven fraud finding.

3. Create 30 fixed evaluation cases covering ordinary instructions, equivalent tested language inputs, boundary arithmetic, failure recovery, authorization, prompt injection, duplicate/concurrent operations, and quota/provider failure. Store cases with expected outcomes. A successful blocked outcome counts as correct behavior. Run deterministic/mock evaluation and report it separately from real-model evaluation. Suggested project targets: >=27/30 correct expected outcomes, all tested money calculations exact, zero unauthorized successful payments. These are our targets, not official judging thresholds. With intentionally configured credentials and an explicit bounded live-evaluation setting, run a small measured live set; do not fabricate missing runs or extrapolate production safety. Record denominator, failures, model/version, environment, latency, token usage, and cost only when pricing and usage are known.

4. Save genuine, redacted evidence in artifacts/evidence: successful tool trace, human approval reference, ledger before/after, receipt, rejected malicious case with unchanged payment ledger, and actual evaluation results. Export through a reproducible script. Add a labeled offline evidence viewer for these records. Do not substitute scripted dialogue or static success screens for actual operation evidence.

5. Prepare concise submission material grounded in the implementation: README with installation/reset/run/test commands and local runtime setup; technical architecture and quote algorithm; security self-assessment with permission tiers, implemented controls, tested attacks, and known limits; AI_USAGE.md stating actual coding/runtime tools and human review; dependency licenses/versions. Include text-PDF extraction only if the core is stable and you can test it without expanding into OCR. Keep unsupported inputs explicit.

6. Write a ten-slide English pitch with speaker notes that fits <=10 minutes and a <=5-minute demo script. Structure: real student task; observed user evidence or clearly labeled hypothesis; product walkthrough; why an agent helps; route/reserve algorithm; approval/security; actual evaluation; architecture/limits; deployment/business hypothesis; next steps. Use measured results only and leave uncollected interviews as labeled TODOs. Provide a clean local HTML slide deck with keyboard navigation/print layout or reuse an existing presentation format. Export PDF if the installed toolchain supports it; otherwise name the exact manual export step and do not claim a PDF exists. Write short judge-Q&A answers, including why AI instead of a form, why simulated payments, differentiation from existing tuition providers, failure handling, economics, and Shenzhen provider readiness.

7. Record a genuine <=5-minute demo if available browser/recording tools allow it; otherwise deliver a precise recording script and an explicit missing-video checklist item. Record a live-model synthetic-money run only when it actually works; disclose mock mode or replay when used. Include success and blocked execution, and rehearse timing. A recording/offline viewer is a backup; organizer permission for its use at finals is pending.

8. Produce a submission checklist and a clean package script: include source, lockfile, docs, presentation, tests, and redacted evidence; exclude secrets, private uploads, node_modules, and non-demo credentials. Use a placeholder for a repository URL until a real one is provided. Identify missing video/PDF/live test/user evidence/organizer answers precisely. The deadline is 20 October 2026 at 23:59 Beijing; recommend submitting 19 October. Registration contacts differ between CMU and IEEE notices, so confirmation is a human checklist item. Do not email, register, publish, deploy, push, or perform real financial transactions.

Run relevant tests/type checks/build after changes, inspect the final UI/deck if browser tools exist, and verify the package contents. Keep output concise and distinguish passed, failed, and not run. Update docs/HANDOFF.md with actual final state and remaining human tasks. Finish with exact run/test/package commands, deliverable paths, actual evaluation totals, and the remaining submission blockers. Do not label an incomplete package competition-ready. Begin now.
```

## Human work alongside the coding sessions

The agent can prepare the software and materials. You and your teammates still need to:

- Finalize and register the eligible team now; obtain confirmation through the correct organizer channel.
- Collect 5–10 real student accounts, with consent, without uploading banking/passport documents. Ask what they last paid, currency/route, unexpected costs, arrival time, checks, and the hardest step. Record anonymized findings and actual counts.
- Supply legitimate development inference access and a modest monitored runtime budget. Start with one live smoke test before an evaluation batch.
- Confirm AI-code disclosure, applicable rubric, final format, under-18 arrangements if relevant, and supported venue inference. No provider connection should be advertised until tested.
- Read and understand the money algorithm, approval gate, tool loop, and ledger transaction. Rehearse the English defense and answers. A useful recording sequence is 0:00 problem; 0:30 task/invoice; 1:15 quote reasoning; 2:15 approval/payment/receipt; 3:15 blocked attack; 4:00 actual evaluation and limits; finish before 5:00.
- Test installation on a teammate's machine, verify every submitted file, and check receipt of the submission before the deadline.

Recommended effort order: core correctness, visible evidence, real student feedback, then presentation polish. Avoid adding extra corridors or unrelated finance features during final preparation.

## Sources

- **R1:** [International Track organizer brief, hosted by ITS](https://www.its.ac.id/international/wp-content/uploads/sites/66/2026/10/PBCSF-Appendix-2-Problem-Description-and-Competition-Rules-for-International-Track.pdf).
- **R2:** [IEEE CIS Singapore, technical-guidance institution, 2026 notice](https://www.ieee-cis-singapore.org/2026-fintechathon).
- **R3:** Official competition website, [2026 English home](https://fintechathon.g-ican.com/#/en/) and [Rules](https://fintechathon.g-ican.com/#/en/rule). Its public JavaScript localization supplied the current schedule and general rubric. The general rubric does not settle the International-specific discrepancy.
- **R4:** [HKUST Guangzhou, 17 December 2025, prize-winning projects and participant remarks](https://www.hkust-gz.edu.cn/zh/?p=13630).
- **R5:** [Capital University of Economics and Business, 12 December 2025, second-prize team's final experience](https://news.cueb.edu.cn/xydt/yx/a02b8adbf71f469fb23302e6383b4ce2.htm).
- **R6:** [CMU opportunity and registration notice](https://ird.oou.cmu.ac.th/2026-shenzhen-international-fintech-competition/).
- **R7:** [Anthropic subscription/IDE usage and billing](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan).
- **R8:** [Official model aliases and opusplan](https://code.claude.com/docs/en/model-config).
- **R9:** [Official verification and context-management guidance](https://code.claude.com/docs/en/best-practices).
- **R10:** [Anthropic supported regions](https://www.anthropic.com/supported-countries).
- **R11:** [Official Claude Code VS Code setup](https://code.claude.com/docs/en/vs-code).

Research limitations: publicly available notices, rules, university accounts, and vendor documentation were checked. No direct organizer reply, unpublished score sheet, or interview with a past participant was obtained. Product architecture and evaluation thresholds are our own proposal. Reconfirm time-sensitive terms before submission and travel.
