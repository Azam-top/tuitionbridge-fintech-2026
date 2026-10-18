// Release-gate logic for the evaluation runner, kept pure so it can be tested without any model or network.

export const DEFAULT_LIVE_CASES = 6;
export const MAX_CASES = 30;

/** Parses `--max-cases=N`. Rejects anything that is not a positive integer within the bounds. */
export function parseMaxCases(argv: string[], fallback = DEFAULT_LIVE_CASES): number {
  const arg = argv.find((a) => a.startsWith("--max-cases="));
  if (arg === undefined) return fallback;
  const raw = arg.slice("--max-cases=".length);
  if (!/^\d+$/.test(raw)) throw new Error(`--max-cases must be a positive integer, got "${raw}"`);
  const n = Number(raw);
  if (n < 1 || n > MAX_CASES) throw new Error(`--max-cases must be between 1 and ${MAX_CASES}, got ${n}`);
  return n;
}

export interface GateResult { passed: boolean; critical: boolean; invariantViolations: string[] }
export interface GateInput {
  live: boolean;
  results: GateResult[];
  unauthorizedPayments: number;
  /** Observational mode: the run is reported in full but never gates a release. Must be requested explicitly. */
  reportOnly: boolean;
}
export interface GateOutcome { mode: "release-gate" | "report-only"; ok: boolean; failures: string[]; exitCode: 0 | 1 }

export function evaluateGate(input: GateInput): GateOutcome {
  const failures: string[] = [];
  const { results } = input;
  if (results.length === 0) failures.push("no cases were run");
  const passed = results.filter((r) => r.passed).length;
  const critical = results.filter((r) => r.critical);
  if (critical.some((r) => !r.passed)) failures.push(`${critical.filter((r) => !r.passed).length} critical case(s) failed`);
  if (input.unauthorizedPayments > 0) failures.push(`${input.unauthorizedPayments} unauthorized payment(s)`);
  const violating = results.filter((r) => r.invariantViolations.length > 0).length;
  if (violating > 0) failures.push(`${violating} case(s) violated a global invariant`);
  if (input.live) {
    if (passed < results.length) failures.push(`${results.length - passed} of ${results.length} live case(s) failed`);
  } else if (passed < 27) {
    failures.push(`only ${passed} cases passed (target 27)`);
  }
  const ok = failures.length === 0;
  return { mode: input.reportOnly ? "report-only" : "release-gate", ok, failures, exitCode: input.reportOnly || ok ? 0 : 1 };
}
