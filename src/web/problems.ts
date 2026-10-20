// Turns a stopped task into a plain-language problem with a next action. It reads only what the server stored
// (task error code, tool results, the "Provider quotes" note); it never invents a cause and never hides a failure.
import type { TaskView } from "./api";

export type ProblemKind = "wise" | "no-offers" | "model" | "limit" | "no-route" | "other";
export type ProblemAction = "retry" | "manual";

export interface Problem {
  kind: ProblemKind;
  title: string;
  reason: string;
  actions: ProblemAction[];
}

const QUOTES_NOTE = /^Provider quotes:\s*/;

/** The server's note about the Wise fetch for this task, when there was one. */
export function wiseNote(view: TaskView): string | null {
  const e = view.events.find((x) => x.kind === "info" && x.text && QUOTES_NOTE.test(x.text));
  return e?.text ? e.text.replace(QUOTES_NOTE, "") : null;
}

const wiseFailed = (note: string | null): boolean => !!note && !/^Fetched \d+ Wise option/.test(note);

/** The server's note about the Wise fetch, in plain words. */
function wiseReason(note: string | null): string {
  if (!note) return "Wise did not return any quotes.";
  if (/could not be reached/i.test(note)) return "Wise could not be reached right now.";
  if (/switched off/i.test(note)) return "Wise quotes are off in this setup.";
  return "Wise did not return a usable quote for this amount.";
}

/** The adapter's sanitized failure text, in plain words (no provider or model names). */
function modelReason(msg: string): string {
  if (/rate limit/i.test(msg)) return "The AI service is busy right now. Wait a minute, then try again.";
  if (/did not answer/i.test(msg)) return "The AI service did not answer in time. Try again.";
  if (/could not reach|network/i.test(msg)) return "Could not reach the AI service. Check your connection and try again.";
  const http = /HTTP (\d{3})/.exec(msg);
  if (http) return `The AI service returned an error (${http[1]}). Trying again usually works.`;
  return "The AI service did not respond. Try again.";
}

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
      ? { kind: "wise", title: "Wise quotes could not be loaded", reason: `${wiseReason(note)} Try again, or add your bank's offer.`, actions: ["retry", "manual"] }
      : { kind: "no-offers", title: "No current options", reason: "No offer is valid right now. Try again for fresh Wise quotes, or add your bank's offer.", actions: ["retry", "manual"] };
  }
  if (state === "FAILED" && code === "PROVIDER_FAILURE") {
    return { kind: "model", title: "The AI assistant could not finish", reason: modelReason(msg), actions: ["retry"] };
  }
  if (state === "FAILED" && code === "LIMIT_REACHED") {
    return { kind: "limit", title: "The planning run hit its safety limit", reason: "The plan stopped on purpose after too many steps. Try again.", actions: ["retry"] };
  }
  if (state === "BLOCKED" && !error) return null; // e.g. no feasible route: the summary already lists the reasons
  return { kind: "other", title: state === "FAILED" ? "The plan stopped" : "The plan was blocked", reason: msg || "The plan could not be completed.", actions: ["retry"] };
}
