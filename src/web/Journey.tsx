import type { Config, Invoice, TaskView } from "./api";

export const STEPS = ["Confirm invoice", "Plan", "Review and approve", "Receipt"];
export const LIVE_STEPS = ["Set up", "Invoice", "Plan", "Review", "Pay"];

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
  if (s === "RUNNING") return { tone: "wait", title: "Comparing your options", body: live ? "Getting current quotes and checking them against your invoice and reserve." : "Comparing the test quotes against your invoice and reserve." };
  if (s === "AWAITING_APPROVAL") return { tone: "go", title: "Review and approve", body: "Check the recipient, amounts and timing, then approve or reject." };
  if (s === "EXECUTING") return { tone: "wait", title: "Recording your approved payment", body: "Writing it to the sandbox ledger." };
  if (live && (s === "APPROVED" || invoice?.status === "INSTRUCTED")) return { tone: "go", title: "Complete your payment", body: "Follow the instruction below. TuitionBridge does not move money." };
  if (!live && !active && s === "COMPLETED") return { tone: "done", title: "Payment recorded in the sandbox", body: "The receipt below is a simulated record, not a bank transfer." };
  if (!active && invoice?.status === "PAID") return { tone: "done", title: "This invoice is paid (simulated)", body: "Load another invoice or a demo scenario to try a different case." };
  if (!active && s === "BLOCKED") return { tone: "stop", title: "No plan yet", body: "See the reason on the right. Fix the invoice, reserve or offers, then plan again." };
  if (!active && s === "FAILED") return { tone: "stop", title: "The plan stopped", body: "See the reason on the right and try again." };
  if (!active && s === "CANCELLED") return { tone: "stop", title: "Cancelled", body: "Plan again whenever you are ready." };
  if (live && !c.setupDone) return { tone: "go", title: "Set up your funds and university", body: "Enter your USD funds and living reserve, then add your university's account from its official payment page." };
  if (!invoice) return { tone: "go", title: "Add your invoice", body: "Enter it by hand or upload a text PDF, then check every field." };
  if (invoice.status === "PAID") return { tone: "done", title: "This invoice is paid (simulated)", body: "Nothing further is needed." };
  if (invoice.status === "BLOCKED") return { tone: "stop", title: "Correct the invoice", body: "A field did not pass the check. Edit it, then confirm again." };
  if (invoice.status === "DRAFT") return { tone: "go", title: "Check the invoice", body: "Confirm the recipient, amount and deadline are right." };
  if (live && c.config?.agentStatus === "NOT_CONFIGURED") return { tone: "stop", title: "Planning needs setup", body: "Add an AI model as described above. Your invoice is saved." };
  if (live && c.offerCount === 0 && !c.config?.wiseQuotes) return { tone: "go", title: "Add an offer", body: "Wise quotes are off in this setup. Enter your bank's offer, then plan." };
  return { tone: "go", title: "Plan your payment", body: live ? "Choose your goal and living reserve. We get current Wise quotes and compare them." : "Choose your goal and living reserve, then plan." };
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
