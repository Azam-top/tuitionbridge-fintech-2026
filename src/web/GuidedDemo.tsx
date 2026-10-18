import { useState } from "react";
import { api, ApiFailure, type Config } from "./api";
import { Card, Chip } from "./components";
import { explain } from "./friendly";

export interface Scenario {
  key: string;
  server: string;
  title: string;
  why: string;
  watch: string[];
  instruction: string;
}

export const SCENARIOS: Scenario[] = [
  {
    key: "s1", server: "standard", title: "1. Successful payment",
    why: "An affordable payment that keeps your living funds, approved by you.",
    watch: ["USD 300.00 reserve is respected", "You approve the exact transaction", "The receipt and ledger match what you approved"],
    instruction: "Pay this invoice by its deadline, use the cheapest feasible route, and keep USD 300 for living costs.",
  },
  {
    key: "s2", server: "standard", title: "2. Cheapest route rejected for lateness",
    why: "The cheapest provider on paper would arrive after the deadline, so it is excluded.",
    watch: ["BudgetBridge is the lowest total but marked LATE", "SteadyPay is selected instead", "Reject the proposal: nothing is paid"],
    instruction: "Pay this invoice by its deadline, use the cheapest feasible route, and keep USD 300 for living costs.",
  },
  {
    key: "s3", server: "malicious", title: "3. Malicious invoice instructions",
    why: "The invoice text tries to waive approval and redirect funds. It has no authority.",
    watch: ["The notes are shown as untrusted text", "The approval card still shows the trusted account", "Nothing moves until you decide; reject to see zero debit"],
    instruction: "Pay this invoice by its deadline, use the cheapest feasible route, and keep USD 300 for living costs.",
  },
  {
    key: "s4", server: "insufficient", title: "4. Insufficient funds",
    why: "Your USD balance cannot cover any route while keeping the reserve.",
    watch: ["Every route is excluded with a factual reason", "No proposal is created", "The balance stays untouched"],
    instruction: "Pay this invoice by its deadline, use the cheapest feasible route, and keep USD 300 for living costs.",
  },
];

export function GuidedDemo({ config, current, onLoaded, onError }: {
  config: Config; current: string | null;
  onLoaded: (s: Scenario | { server: string; instruction?: string; key: string }) => void | Promise<void>; onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState("all_late");
  const active = SCENARIOS.find((s) => s.key === current);

  async function load(s: Scenario | { key: string; server: string }) {
    setBusy(true);
    try {
      await api("POST", "/api/demo/reset", { scenario: s.server });
      await onLoaded(s);
    } catch (e) { onError(explain(e, e instanceof ApiFailure ? e.message : "Reset failed.")); } finally { setBusy(false); }
  }

  return (
    <Card id="demo" title="Demo scenarios" aside={<Chip tone="muted">local demo only</Chip>}>
      <ul className="scenarios" role="list">
        {SCENARIOS.map((s) => (
          <li key={s.key} className={current === s.key ? "on" : ""}>
            <button className="scn" onClick={() => load(s)} disabled={busy} aria-pressed={current === s.key} data-testid={`scenario-${s.key}`}>
              <strong>{s.title}</strong>
              <span>{s.why}</span>
            </button>
          </li>
        ))}
      </ul>
      {active && (
        <div className="watch" data-testid="watch-for">
          <strong>Watch for:</strong>
          <ul>{active.watch.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}
      <details className="more">
        <summary>More datasets</summary>
        <label className="field">
          <span>Dataset</span>
          <select value={more} onChange={(e) => setMore(e.target.value)} data-testid="scenario">
            {config.scenarios.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
        </label>
        <button className="btn" onClick={() => load({ key: `x-${more}`, server: more })} disabled={busy} data-testid="reset-demo">Reset with this dataset</button>
      </details>
      <p className="hint">Each button wipes all demo records (both accounts) and reseeds. The deadline is always 48 hours from the reset. Every figure and status you see comes from the server.</p>
    </Card>
  );
}
