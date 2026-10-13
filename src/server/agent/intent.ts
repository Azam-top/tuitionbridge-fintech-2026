import { parseInstruction } from "../../shared/intent.js";
import type { Preference } from "../../shared/policy.js";
import { PolicyError } from "../errors.js";
import { parseMinor } from "../../shared/money.js";

export interface TaskIntent {
  preference: Preference | null; // null until stated by the instruction or chosen by the model within the enum
  preferenceSource: "instruction" | "model" | "default" | null;
  reserveCents: string; // effective, server-validated living-expense reserve
  reserveSource: "instruction" | "account_default";
  language: "en" | "ru" | "unknown";
  instruction: string;
}

export const MAX_INSTRUCTION_CHARS = 500;

/** Server-side validation of the student's instruction. Conflicts are rejected, never guessed. */
export function resolveIntent(instruction: string, accountReserveCents: string): TaskIntent {
  const text = instruction.trim();
  if (!text) throw new PolicyError("VALIDATION", "Instruction is empty.");
  if (text.length > MAX_INSTRUCTION_CHARS) throw new PolicyError("VALIDATION", `Instruction is longer than ${MAX_INSTRUCTION_CHARS} characters.`);
  const p = parseInstruction(text);
  if (p.ambiguous.length) {
    throw new PolicyError("INTENT_CONFLICT", `${p.ambiguous.join(" ")} Please state a single preference and a non-zero reserve.`);
  }
  return {
    preference: p.preference,
    preferenceSource: p.preference ? "instruction" : null,
    reserveCents: p.reserveCents ?? accountReserveCents,
    reserveSource: p.reserveCents ? "instruction" : "account_default",
    language: p.language,
    instruction: text,
  };
}

/**
 * The model may not silently change a confirmed constraint:
 * - a preference stated in the instruction cannot be overridden,
 * - the reserve may be equal or higher, never lower.
 * Returns the (possibly newly chosen) preference.
 */
export function enforceIntent(intent: TaskIntent, argPreference: Preference, argReserveCents: string): Preference {
  if (intent.preference && intent.preference !== argPreference) {
    throw new PolicyError("INTENT_CONFLICT", `The student asked for the ${intent.preference} route; the preference cannot be changed to ${argPreference}.`);
  }
  if (parseMinor(argReserveCents) < parseMinor(intent.reserveCents)) {
    throw new PolicyError("RESERVE_LOWERING", `The living-expense reserve is USD ${(Number(intent.reserveCents) / 100).toFixed(2)} and cannot be lowered.`);
  }
  return argPreference;
}
