import type { Config, Invoice, TaskView } from "./api";

export const STEPS = ["Confirm invoice", "Plan", "Review and approve", "Receipt"];
export const LIVE_STEPS = ["Set up", "Confirm invoice", "Plan", "Review and approve", "Pay and upload"];

export interface JourneyCtx { config: Config | null; setupDone: boolean; offerCount: number }

/** Sandbox keeps the original four steps (its test ids and labels are unchanged). */
export function stepIndex(invoice: Invoice | null, task: TaskView | null): number {
  const s = task?.task.state;
  if (s === "COMPLETED") return 3;
  if (s === "AWAITING_APPROVAL" || s === "EXECUTING") return 2;
  if (s === "RUNNING") return 1;
  if (invoice?.status === "CONFIRMED") return 1;
  return 0;
}

export function liveStepIndex(invoice: Invoice | null, task: TaskView | null, c: JourneyCtx): number {
  const s = task?.task.state;
  if (s === "APPROVED" || invoice?.status === "INSTRUCTED") return 4;
  if (s === "AWAITING_APPROVAL") return 3;
  if (s === "RUNNING") return 2;
  if (!c.setupDone) return 0;
  if (invoice?.status === "CONFIRMED") return 2;
  return 1;
}

interface Next { tone: "go" | "wait" | "stop" | "done"; title: string; body: string }

/** One plain-language next action per situation. Statuses come from server records, never from model text. */
export function nextStep(invoice: Invoice | null, task: TaskView | null, c: JourneyCtx): Next {
  const s = task?.task.state;
  const active = s === "RUNNING" || s === "AWAITING_APPROVAL" || s === "EXECUTING";
  const live = c.config?.appMode === "live";
  if (s === "RUNNING") return { tone: "wait", title: "The agent is comparing routes", body: live ? "It reads your confirmed invoice, declared funds and current offers, then prepares one proposal. Nothing is paid." : "It reads your confirmed invoice and balances, fetches quotes and prepares one proposal. Nothing is paid." };
  if (s === "AWAITING_APPROVAL") return { tone: "go", title: "Your decision: approve or reject", body: "Compare the routes, check the recipient, the amounts and where each offer came from, then approve or reject the exact payment below." };
  if (s === "EXECUTING") return { tone: "wait", title: "Recording your approved payment", body: "The payment is being written to the sandbox ledger." };
  if (live && (s === "APPROVED" || invoice?.status === "INSTRUCTED")) return { tone: "go", title: "Pay outside the app, then keep your confirmation", body: "The app has not moved any money. Follow the instruction below in your bank or Wise, then mark it paid or upload your confirmation. Both are stored as your own evidence, not as verification." };
  if (!live && !active && s === "COMPLETED") return { tone: "done", title: "Payment recorded in the sandbox ledger", body: "Your receipt is below. This is a simulated record, not a bank transfer." };
  if (!active && invoice?.status === "PAID") return { tone: "done", title: "This invoice is already paid (simulated)", body: "Load another invoice or a demo scenario to try a different case." };
  if (!active && s === "BLOCKED") return { tone: "stop", title: "Nothing was paid", body: "Read the reason below. If a detail was wrong, correct the invoice and confirm it again. The agent never lowers your living-expense reserve or moves the deadline to make a route fit." };
  if (!active && s === "FAILED") return { tone: "stop", title: "The task stopped; nothing was paid", body: live ? "You can start a new plan." : "A payment exists only if a receipt is shown. You can start a new plan." };
  if (!active && s === "CANCELLED") return { tone: "stop", title: "Cancelled: nothing was paid", body: "Plan again whenever you are ready." };
  if (live && !c.setupDone) return { tone: "go", title: "Set up your funds and your recipient", body: "Declare the USD you have and the amount to keep for living costs, then add your university from its official payment page." };
  if (!invoice) return { tone: "go", title: "Add your invoice", body: "Enter it by hand or upload a text PDF. You will review every field." };
  if (invoice.status === "PAID") return { tone: "done", title: "This invoice is already paid (simulated)", body: "Nothing further is needed." };
  if (invoice.status === "BLOCKED") return { tone: "stop", title: "Correct the invoice", body: "The recipient or a field did not pass validation. Edit it, then revalidate and confirm." };
  if (invoice.status === "DRAFT") return { tone: "go", title: "Check the invoice details", body: "Confirm the recipient, amount and deadline are right. The agent only works on invoices you confirmed." };
  if (live && c.config?.agentStatus === "NOT_CONFIGURED") return { tone: "stop", title: "Planning needs a model", body: "Follow the setup banner above to configure a model. Your invoice and offers are saved." };
  if (live && c.offerCount === 0) return { tone: "go", title: "Add payment options", body: "Get a live Wise quote or enter an offer from your bank. Then ask the agent to plan." };
  return { tone: "go", title: "Tell the agent what to do", body: "Describe your preference and the living-expense reserve to keep, then press Plan my payment." };
}

export function Journey({ invoice, task, ctx }: { invoice: Invoice | null; task: TaskView | null; ctx: JourneyCtx }) {
  const live = ctx.config?.appMode === "live";
  const steps = live ? LIVE_STEPS : STEPS;
  const step = live ? liveStepIndex(invoice, task, ctx) : stepIndex(invoice, task);
  const next = nextStep(invoice, task, ctx);
  return (
    <section className="journey" aria-label="Progress">
      <ol className={`stepper${live ? " stepper-5" : ""}`} data-testid="stepper">
        {steps.map((s, i) => (
          <li key={s} className={i < step ? "done" : i === step ? "now" : ""} aria-current={i === step ? "step" : undefined}>
            <span className="dot" aria-hidden="true">{i < step ? "✓" : i + 1}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
      <div className={`next next-${next.tone}`} data-testid="next-step">
        <p className="next-label">Next step</p>
        <h2>{next.title}</h2>
        <p>{next.body}</p>
      </div>
    </section>
  );
}
