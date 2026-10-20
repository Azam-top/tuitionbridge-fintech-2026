// Turns a stopped task into a plain-language problem with a next action. It reads only what the server stored
// (task error code, tool results, the "Provider quotes" note); it never invents a cause and never hides a failure.
import type { TaskView } from "./api";

export type ProblemKind = "wise" | "no-offers" | "model" | "limit" | "no-route" | "other";
export type ProblemAction = "retry" | "manual";

export interface Problem {
  kind: ProblemKind;
  title: string;
  reason: string;
  /** Always true: a stopped task never moves money. Shown so the user is never left wondering. */
  nothingPaid: true;
  actions: ProblemAction[];
}

const QUOTES_NOTE = /^Provider quotes:\s*/;

/** The server's note about the Wise fetch for this task, when there was one. */
export function wiseNote(view: TaskView): string | null {
  const e = view.events.find((x) => x.kind === "info" && x.text && QUOTES_NOTE.test(x.text));
  return e?.text ? e.text.replace(QUOTES_NOTE, "") : null;
}

const wiseFailed = (note: string | null): boolean => !!note && !/^Fetched \d+ Wise option/.test(note);

/** "PROVIDER_FAILURE: Groq rate limit (HTTP 429)." -> ["PROVIDER_FAILURE", "Groq rate limit (HTTP 429)."] */
function splitError(err: string | null): [string, string] {
  const m = /^([A-Z_]+):\s*(.*)$/s.exec(err ?? "");
  return m ? [m[1], m[2]] : ["", err ?? ""];
}

export function diagnose(view: TaskView | null): Problem | null {
  if (!view) return null;
  const { state, error } = view.task;
  if (state !== "FAILED" && state !== "BLOCKED") return null;
  const [code, msg] = splitError(error);
  const note = wiseNote(view);
  const quotesTool = [...view.events].reverse().find((e) => e.kind === "tool" && e.tool === "get_quotes");
  const noOffers = (quotesTool?.output as { error?: { code?: string } } | null | undefined)?.error?.code === "NO_OFFERS";

  if (state === "BLOCKED" && noOffers) {
    return wiseFailed(note)
      ? { kind: "wise", title: "Wise quotes could not be loaded", reason: `${note} Nothing was invented in their place.`, nothingPaid: true, actions: ["retry", "manual"] }
      : { kind: "no-offers", title: "There are no current payment options", reason: "No offer is valid right now. Try again for fresh Wise quotes, or add an offer you were given by your bank.", nothingPaid: true, actions: ["retry", "manual"] };
  }
  if (state === "FAILED" && code === "PROVIDER_FAILURE") {
    const rate = /rate limit/i.test(msg);
    return {
      kind: "model", title: "The AI assistant could not finish",
      reason: `${msg || "The model provider did not answer."}${rate ? " Wait a minute, then try again." : " Trying again usually works."}`,
      nothingPaid: true, actions: ["retry"],
    };
  }
  if (state === "FAILED" && code === "LIMIT_REACHED") {
    return { kind: "limit", title: "The planning run hit its safety limit", reason: `${msg} It stopped on purpose so it cannot loop or overspend. Try again.`, nothingPaid: true, actions: ["retry"] };
  }
  if (state === "BLOCKED" && !error) return null; // e.g. no feasible route: the summary already lists the reasons
  return { kind: "other", title: state === "FAILED" ? "The plan stopped" : "The plan was blocked", reason: msg || "The server stopped this task.", nothingPaid: true, actions: ["retry"] };
}
