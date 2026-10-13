# Judge Q&A (short answers, grounded in what exists)

**Why an AI agent instead of a form?**
A form computes numbers; the messy parts are free-text preferences ("cheapest, keep $300"), explaining why routes were excluded, and recovering from blocks (mismatch, ambiguity, expired quote). The agent handles those through a bounded tool loop. It is deliberately not trusted with money or authority: arithmetic, ranking, approval and the ledger are deterministic server code. Honest status: our demos use a deterministic MOCK agent; the live-model adapter exists but is not verified.

**Why simulated payments?**
Real rails need a licensed provider, KYC/AML and contracts that a competition prototype cannot responsibly claim. A sandbox ledger lets us prove the part we control: authorization, expiry, ownership, duplicate prevention and exact money math, with evidence. Replacing the simulated quote and payment services with provider sandbox APIs is the integration step.

**How is this different from existing tuition-payment providers?**
We do not claim they lack these features. Our hypothesis is that students need decision support that keeps living funds, deadlines, recipient checks and total cost in one place, and that an approval-bound agent can provide it in front of any licensed provider. That hypothesis is unvalidated until interviews are done.

**What if the model misbehaves or is prompt-injected?**
Safety does not depend on the model. There is no approval tool; the execution tool exists only after a human approval record; model arguments are validated against the parsed intent (reserve cannot be lowered, stated preference cannot be changed); invoice text is untrusted data; execution rechecks everything inside one atomic transaction. We tested a scripted model that obeys an injected invoice: every unsafe call was refused and the payment ledger was unchanged. Whether a real model is *good* is separate and unmeasured.

**How do you handle failures?**
Provider errors: up to 2 bounded retries, then a visible FAILED state with nothing paid. Limits (8 tool calls, 10 model requests, token budget) fail visibly. Expired quote or approval: refused, nothing paid, plan again. Recipient mismatch or ambiguity: invoice blocked with a recoverable correction path. Server restart mid-task: the task is marked interrupted, or completed if the payment had already been recorded.

**Is the live model working?**
Not verified. The adapter uses the official SDK and is tested against a local fake provider; a bounded smoke test (`npm run smoke:live`) and a small live evaluation (`npm run eval:live`) are ready but require a configured key and were not run.

**What do the evaluation numbers mean?**
30 fixed cases, deterministic: model-driven cases use the MOCK agent, adversarial and failure cases use scripted models or direct calls. 30/30 pass with 12/12 critical cases and zero unauthorized payments. That is evidence about the server's policy layer, not about real-model behavior. Targets (≥27/30, all critical) are ours, not the organizers'.

**What are the economics?**
Untested hypotheses: referral or fee share from a licensed provider, or licensing to universities/banks. The deterministic core costs nothing per payment; a model call is only for instruction understanding and explanations. We have no measured cost per task because no live run was made. We will not quote a figure until we have one.

**Can this run at the Shenzhen finals?**
The default MOCK mode needs no network. Live inference there depends on an organizer-approved, supported provider (the provider we adapted is not supported in mainland China). The model adapter is isolated so a supported provider can be swapped in; we have not tested one. We have asked the organizers (see the submission checklist) whether recorded or offline demos are allowed.

**What about compliance?**
Our "security and compliance" work is design controls (tiers, approval binding, audit trail, owner scoping, tested attacks). It is not regulatory approval, KYC/AML, sanctions screening or a certified audit.

**Which rubric are you targeting?**
The International Track brief: task completion 40%, security and compliance 30%, innovation and interaction 30%. The general site lists different labels at the same weights; we asked the organizers which governs.

**Who did the work and how was AI used?**
See `AI_USAGE.md`: AI-assisted coding with Claude Code; human review is for the team to complete and is not yet recorded.
