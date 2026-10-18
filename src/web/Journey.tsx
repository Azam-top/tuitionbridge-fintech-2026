import type { Invoice, TaskView } from "./api";

export const STEPS = ["Confirm invoice", "Plan", "Review and approve", "Receipt"];

export function stepIndex(invoice: Invoice | null, task: TaskView | null): number {
  const s = task?.task.state;
  if (s === "COMPLETED") return 3;
  if (s === "AWAITING_APPROVAL" || s === "EXECUTING") return 2;
  if (s === "RUNNING") return 1;
  if (invoice?.status === "CONFIRMED") return 1;
  return 0;
}

interface Next { tone: "go" | "wait" | "stop" | "done"; title: string; body: string }

/** One plain-language next action per situation. Statuses come from server records, never from model text. */
export function nextStep(invoice: Invoice | null, task: TaskView | null): Next {
  const s = task?.task.state;
  const active = s === "RUNNING" || s === "AWAITING_APPROVAL" || s === "EXECUTING";
  if (s === "RUNNING") return { tone: "wait", title: "The agent is comparing routes", body: "It reads your confirmed invoice and balances, fetches quotes and prepares one proposal. Nothing is paid." };
  if (s === "AWAITING_APPROVAL") return { tone: "go", title: "Your decision: approve or reject", body: "Compare the routes, check the recipient and amounts, then approve or reject the exact payment below." };
  if (s === "EXECUTING") return { tone: "wait", title: "Recording your approved payment", body: "The payment is being written to the sandbox ledger." };
  if (!active && s === "COMPLETED") return { tone: "done", title: "Payment recorded in the sandbox ledger", body: "Your receipt is below. This is a simulated record, not a bank transfer." };
  if (!active && invoice?.status === "PAID") return { tone: "done", title: "This invoice is already paid (simulated)", body: "Load another invoice or a demo scenario to try a different case." };
  if (!active && s === "BLOCKED") return { tone: "stop", title: "Nothing was paid", body: "Read the reason below. If a detail was wrong, correct the invoice and confirm it again. The agent never lowers your living-expense reserve or moves the deadline to make a route fit." };
  if (!active && s === "FAILED") return { tone: "stop", title: "The task stopped; a payment exists only if a receipt is shown", body: "You can start a new plan. A payment that was already recorded is never undone by this error." };
  if (!active && s === "CANCELLED") return { tone: "stop", title: "Cancelled: nothing was paid", body: "Plan again whenever you are ready." };
  if (!invoice) return { tone: "go", title: "Add an invoice", body: "Paste invoice text or upload a text PDF. You will review every extracted field." };
  if (invoice.status === "PAID") return { tone: "done", title: "This invoice is already paid (simulated)", body: "Nothing further is needed." };
  if (invoice.status === "BLOCKED") return { tone: "stop", title: "Correct the invoice", body: "The recipient or a field did not pass validation. Edit it, then revalidate and confirm." };
  if (invoice.status === "DRAFT") return { tone: "go", title: "Check the invoice details", body: "Confirm the recipient, amount and deadline are right. The agent only works on invoices you confirmed." };
  return { tone: "go", title: "Tell the agent what to do", body: "Describe your preference and the living-expense reserve to keep, then press Plan my payment." };
}

export function Journey({ invoice, task }: { invoice: Invoice | null; task: TaskView | null }) {
  const step = stepIndex(invoice, task);
  const next = nextStep(invoice, task);
  return (
    <section className="journey" aria-label="Progress">
      <ol className="stepper" data-testid="stepper">
        {STEPS.map((s, i) => (
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
