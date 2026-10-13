import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiFailure, setCsrf, type Config, type StateResponse, type TaskView } from "./api";
import { Card, Chip, ModeBadges, Row } from "./components";
import { InvoiceCard } from "./InvoiceCard";
import { TaskPanel } from "./TaskPanel";
import { ImportCard } from "./ImportCard";
import { GuidedDemo, type Scenario } from "./GuidedDemo";
import { explain } from "./friendly";
import { formatKzt, formatUsd } from "./format";

const EXAMPLES = [
  "Pay this invoice by its deadline, use the cheapest feasible route, and keep USD 300 for living costs.",
  "Pay this invoice by its deadline, prefer faster arrival, and keep USD 300 for living costs.",
  "Оплати счёт до срока, выбери самый дешёвый вариант и оставь 300 долларов на жизнь.",
];
const ACTIVE = new Set(["RUNNING", "AWAITING_APPROVAL", "EXECUTING"]);

export function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [st, setSt] = useState<StateResponse | null>(null);
  const [task, setTask] = useState<TaskView | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [instruction, setInstruction] = useState(EXAMPLES[0]);
  const [starting, setStarting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scenarioKey, setScenarioKey] = useState<string | null>(null);
  const taskId = useRef<string | null>(null);

  const loadTask = useCallback(async (id: string) => {
    const v = await api<TaskView>("GET", `/api/tasks/${id}`);
    taskId.current = id;
    setTask(v);
    return v;
  }, []);

  const refresh = useCallback(async () => {
    try {
      const s = await api<StateResponse>("GET", "/api/state");
      setSt(s); setConfig(s.config); setAuthed(true);
      const id = taskId.current ?? s.latestTask?.id ?? null;
      if (id) await loadTask(id);
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 401) setAuthed(false);
      else setError(e instanceof ApiFailure ? e.message : "Could not reach the server.");
    }
  }, [loadTask]);

  useEffect(() => {
    void (async () => {
      try { setConfig(await api<Config>("GET", "/api/config")); } catch { /* shown after login attempt */ }
      try {
        const me = await api<{ csrfToken: string }>("GET", "/api/me");
        setCsrf(me.csrfToken);
        await refresh();
      } catch { setAuthed(false); }
    })();
  }, [refresh]);

  // Poll only while the agent is running.
  const active = task && (task.task.state === "RUNNING" || task.task.state === "EXECUTING");
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => { void refresh(); }, 600);
    return () => clearInterval(t);
  }, [active, refresh]);

  const onError = (m: string) => setError(m);
  const taskIsActive = !!task && ACTIVE.has(task.task.state);
  const invoices = st?.invoices ?? [];
  const invoice = invoices.find((i) => i.id === selectedId) ?? invoices.find((i) => i.status !== "PAID") ?? invoices[0] ?? null;

  async function start() {
    if (!invoice) return;
    setError(null); setStarting(true);
    try {
      const v = await api<TaskView>("POST", "/api/tasks", { invoiceId: invoice.id, instruction });
      taskId.current = v.task.id;
      setTask(v);
      await refresh();
    } catch (e) { setError(explain(e, "Could not start the task.")); } finally { setStarting(false); }
  }

  async function logout() {
    try { await api("POST", "/api/auth/logout", {}); } catch { /* ignore */ }
    taskId.current = null; setTask(null); setSt(null); setAuthed(false); setCsrf("");
  }

  if (authed === null) return <main className="shell"><p role="status">Loading…</p></main>;
  if (!authed) return <Login config={config} onDone={async (csrf) => { setCsrf(csrf); setError(null); await refresh(); }} />;

  return (
    <div className="shell">
      <a className="skip" href="#invoice">Skip to the invoice</a>
      <header className="top">
        <div>
          <h1>TuitionBridge</h1>
          <p className="muted small">An agent that pays your tuition invoice only after you approve, and only while keeping your living funds.</p>
        </div>
        <div className="top-right">
          <ModeBadges config={config} />
          <span className="muted small">{st?.user.displayName} · <button className="link" onClick={logout}>Sign out</button></span>
        </div>
      </header>

      <div aria-live="polite" className="toast-area">
        {error && (
          <div className="alert" role="alert" data-testid="error-banner">
            {error} <button className="link" onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}
      </div>

      <main className="grid">
        <aside className="stack">
          <Funds st={st} />
          {config?.demoMode && (
            <GuidedDemo
              config={config} current={scenarioKey} invoice={invoice} task={task}
              onLoaded={async (sc) => {
                taskId.current = null; setTask(null); setError(null); setSelectedId(null); setScenarioKey(sc.key);
                if ("instruction" in sc && sc.instruction) setInstruction(sc.instruction);
                await refresh();
              }}
              onError={onError}
            />
          )}
        </aside>
        <div className="stack">
          {invoices.length > 1 && (
            <label className="field">
              <span>Invoice</span>
              <select value={invoice?.id ?? ""} onChange={(e) => setSelectedId(e.target.value)} data-testid="invoice-select">
                {invoices.map((i) => <option key={i.id} value={i.id}>{i.reference} ({i.status.toLowerCase()})</option>)}
              </select>
            </label>
          )}
          {invoice ? (
            <InvoiceCard invoice={invoice} locked={taskIsActive} onChanged={() => { void refresh(); }} onError={onError} />
          ) : <Card title="Invoice"><p>No invoice yet.</p></Card>}

          <ImportCard disabled={taskIsActive} onImported={(inv) => { setSelectedId(inv.id); setError(null); void refresh(); }} onError={onError} />

          <Card id="instruction" title="Tell the agent what to do">
            <label className="field">
              <span>Your instruction (English; a Russian example is included)</span>
              <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} rows={3} maxLength={500} data-testid="instruction" disabled={taskIsActive} />
            </label>
            <div className="chips">
              {EXAMPLES.map((ex, i) => (<button key={i} className="chip-btn" onClick={() => setInstruction(ex)} disabled={taskIsActive}>Example {i + 1}</button>))}
            </div>
            <div className="actions">
              <button className="btn btn-primary" onClick={start} disabled={starting || taskIsActive || invoice?.status !== "CONFIRMED"} data-testid="start-task">Plan my payment</button>
              {invoice?.status !== "CONFIRMED" && invoice?.status !== "PAID" && <span className="muted small">Confirm the invoice first.</span>}
              {invoice?.status === "PAID" && <span className="muted small">This invoice is already paid.</span>}
            </div>
            <p className="hint">The agent can read, compare and prepare. It cannot approve or lower your reserve. Money moves only after you press Approve.</p>
          </Card>

          {task && st && (
            <TaskPanel view={task} now={st.now} approvalMinutes={config?.limits.approvalMinutes ?? 5} limits={config?.limits ?? { maxToolCalls: 8, maxModelRequests: 10 }} onChanged={() => { void refresh(); }} onError={onError} />
          )}
        </div>
      </main>
      <footer className="foot muted small">
        Synthetic data only. Fictional university and providers. {config ? `Fixtures ${config.fixturesVersion}.` : ""} Quote arrival times are estimates, not guarantees.
      </footer>
    </div>
  );
}

function Funds({ st }: { st: StateResponse | null }) {
  if (!st) return null;
  const b = st.balances;
  return (
    <Card id="funds" title="Your funds">
      <dl className="rows" data-testid="funds">
        <Row label="USD balance" strong testId="usd-balance">{formatUsd(b.usd.balanceCents)}</Row>
        <Row label="USD kept for living costs" testId="usd-reserve">{formatUsd(b.usd.reserveCents)}</Row>
        <Row label="USD available to pay" testId="usd-available">{formatUsd(b.usd.availableCents)}</Row>
        <Row label="KZT balance (not used here)" testId="kzt-balance">{formatKzt(b.kzt.balanceTiyn)}</Row>
      </dl>
      <p className="hint">{b.note}</p>
    </Card>
  );
}

function Login({ config, onDone }: { config: Config | null; onDone: (csrf: string) => void | Promise<void> }) {
  const [email, setEmail] = useState("alice@demo.local");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await api<{ csrfToken: string }>("POST", "/api/auth/login", { email, password });
      await onDone(r.csrfToken);
    } catch (x) { setErr(x instanceof ApiFailure ? x.message : "Sign-in failed."); } finally { setBusy(false); }
  }
  return (
    <main className="shell narrow">
      <h1>TuitionBridge</h1>
      <ModeBadges config={config} />
      <Card title="Sign in (local demo)">
        <form className="form" onSubmit={submit}>
          <label className="field"><span>Email</span><input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" data-testid="email" /></label>
          <label className="field"><span>Password</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" data-testid="password" /></label>
          {err && <p className="alert" role="alert">{err}</p>}
          <button className="btn btn-primary" disabled={busy} data-testid="login-btn">Sign in</button>
        </form>
        <p className="hint">Demo accounts are documented in the README. Everything here is synthetic and payments are simulated.</p>
      </Card>
    </main>
  );
}
