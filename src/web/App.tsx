import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiFailure, setCsrf, type Config, type StateResponse, type TaskView } from "./api";
import { Card, ModeBadges } from "./components";
import { InvoiceCard } from "./InvoiceCard";
import { TaskPanel } from "./TaskPanel";
import { ImportCard } from "./ImportCard";
import { GuidedDemo, type Scenario } from "./GuidedDemo";
import { Journey } from "./Journey";
import { FundsEditor, NewInvoiceCard, OffersCard, RecipientsCard, SetupBanner } from "./LivePanels";
import { explain } from "./friendly";
import { formatUsd } from "./format";

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

  const live = config?.appMode === "live";
  const recipients = st?.recipients ?? [];
  const offers = (invoice && st?.offers[invoice.id]) || [];
  const setupDone = !!st && st.balances.usd.balanceCents !== "0" && recipients.length > 0;
  // The decision and the result lead the page; earlier or failed attempts sit after the invoice and plan cards.
  const taskLeads = !!task && (task.task.state === "AWAITING_APPROVAL" || task.task.state === "EXECUTING" || task.task.state === "COMPLETED");
  const taskPanel = task && st ? (
    <TaskPanel view={task} live={live} now={st.now} approvalMinutes={config?.limits.approvalMinutes ?? 5} limits={config?.limits ?? { maxToolCalls: 8, maxModelRequests: 10 }} onChanged={() => { void refresh(); }} onError={onError} />
  ) : null;

  if (authed === null) return <main className="shell"><p role="status">Loading…</p></main>;
  if (!authed) return <Login config={config} onDone={async (csrf) => { setCsrf(csrf); setError(null); await refresh(); }} />;

  return (
    <div className="shell">
      <a className="skip" href="#invoice">Skip to the invoice</a>
      <header className="top">
        <div>
          <h1>TuitionBridge</h1>
          <p className="muted small">Pay your tuition on time without spending your living money. You approve every payment.</p>
        </div>
        <div className="top-right">
          <ModeBadges config={config} />
          <span className="muted small">{st?.user.displayName} · <button className="link" onClick={logout}>Sign out</button></span>
        </div>
      </header>

      {config?.appMode === "sandbox" && (
        <div className="sandbox-banner" role="note" data-testid="sandbox-banner">
          <strong>SANDBOX · TEST DATA.</strong> Fictional university, providers and users, with payments in a simulated ledger. This is the separate competition check, not the real application mode.
        </div>
      )}
      <SetupBanner config={config} />

      <div aria-live="polite" className="toast-area">
        {error && (
          <div className="alert" role="alert" data-testid="error-banner">
            {error} <button className="link" onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}
      </div>

      <main className={live ? "grid single" : "grid"}>
        {config?.demoMode && (
          <aside className="stack">
            <GuidedDemo
              config={config} current={scenarioKey}
              onLoaded={async (sc) => {
                taskId.current = null; setTask(null); setError(null); setSelectedId(null); setScenarioKey(sc.key);
                if ("instruction" in sc && sc.instruction) setInstruction(sc.instruction);
                await refresh();
              }}
              onError={onError}
            />
          </aside>
        )}
        <div className="stack">
          <Journey invoice={invoice} task={task} ctx={{ config, setupDone, offerCount: offers.filter((o) => !o.expired).length }} />
          <Budget st={st} live={live} />
          {live && st && <FundsEditor key={st.balances.usd.balanceCents + st.balances.usd.reserveCents} balances={st.balances} locked={taskIsActive} onSaved={() => { setError(null); void refresh(); }} onError={onError} />}
          {live && <RecipientsCard recipients={recipients} onChanged={() => { setError(null); void refresh(); }} onError={onError} />}
          {taskLeads && taskPanel}
          {invoices.length > 1 && (
            <label className="field">
              <span>Invoice</span>
              <select value={invoice?.id ?? ""} onChange={(e) => setSelectedId(e.target.value)} data-testid="invoice-select">
                {invoices.map((i) => <option key={i.id} value={i.id}>{i.reference} ({i.status.toLowerCase()})</option>)}
              </select>
            </label>
          )}
          {invoice ? (
            <InvoiceCard invoice={invoice} locked={taskIsActive} live={live} onChanged={() => { void refresh(); }} onError={onError} />
          ) : <Card title="Invoice"><p>No invoice yet.</p></Card>}

          {live && !invoices.length && <NewInvoiceCard recipients={recipients} onCreated={(inv) => { setSelectedId(inv.id); setError(null); void refresh(); }} onError={onError} />}
          {live && invoice?.status === "CONFIRMED" && config && <OffersCard invoice={invoice} offers={offers} reference={st?.reference ?? null} config={config} onChanged={() => { setError(null); void refresh(); }} onError={onError} />}

          <Card id="instruction" title="Plan the payment">
            <label className="field">
              <span>What should the agent do? (English; a Russian example is included)</span>
              <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} rows={3} maxLength={500} data-testid="instruction" disabled={taskIsActive} />
            </label>
            <div className="chips">
              {EXAMPLES.map((ex, i) => (<button key={i} className="chip-btn" onClick={() => setInstruction(ex)} disabled={taskIsActive}>Example {i + 1}</button>))}
            </div>
            <div className="actions">
              <button className="btn btn-primary" onClick={start} disabled={starting || taskIsActive || invoice?.status !== "CONFIRMED" || config?.agentStatus === "NOT_CONFIGURED"} data-testid="start-task">Plan my payment</button>
              {invoice?.status !== "CONFIRMED" && invoice?.status !== "PAID" && invoice?.status !== "INSTRUCTED" && <span className="muted small">Confirm the invoice first.</span>}
              {(invoice?.status === "PAID" || invoice?.status === "INSTRUCTED") && <span className="muted small">{invoice.status === "PAID" ? "This invoice is already paid." : "A payment instruction was already issued for this invoice."}</span>}
              {config?.agentStatus === "NOT_CONFIGURED" && <span className="muted small">Planning is disabled until a model is configured.</span>}
            </div>
            <p className="hint">The agent can read, compare and prepare. It cannot approve or lower your reserve; {live ? "after you approve, the app issues a payment instruction and moves no money." : "money moves only after you approve."}</p>
          </Card>

          {!taskLeads && taskPanel}

          {live && invoices.length > 0 && <NewInvoiceCard recipients={recipients} defaultOpen={false} onCreated={(inv) => { setSelectedId(inv.id); setError(null); void refresh(); }} onError={onError} />}
          <ImportCard disabled={taskIsActive} onImported={(inv) => { setSelectedId(inv.id); setError(null); void refresh(); }} onError={onError} />
        </div>
      </main>
      <footer className="foot muted small">
        {live ? "Live mode: your own data. The app issues payment instructions and never moves money." : `Fictional university, providers and data. Fixtures ${config?.fixturesVersion ?? ""}.`}
      </footer>
    </div>
  );
}

function Budget({ st, live }: { st: StateResponse | null; live: boolean }) {
  if (!st) return null;
  const b = st.balances;
  return (
    <section className="budget" id="funds" aria-label="Your funds" data-testid="funds">
      <div><span>{live ? "USD you declared" : "USD balance"}</span><strong className="num" data-testid="usd-balance">{formatUsd(b.usd.balanceCents)}</strong></div>
      <div><span>Kept for living costs</span><strong className="num" data-testid="usd-reserve">{formatUsd(b.usd.reserveCents)}</strong></div>
      <div><span>Available to pay</span><strong className="num" data-testid="usd-available">{formatUsd(b.usd.availableCents)}</strong></div>
    </section>
  );
}

function Login({ config, onDone }: { config: Config | null; onDone: (csrf: string) => void | Promise<void> }) {
  const live = config?.appMode === "live";
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [email, setEmail] = useState(live ? "" : "alice@demo.local");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const registering = live && mode === "register";
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = registering
        ? await api<{ csrfToken: string }>("POST", "/api/auth/register", { email, displayName: name, password })
        : await api<{ csrfToken: string }>("POST", "/api/auth/login", { email, password });
      await onDone(r.csrfToken);
    } catch (x) { setErr(x instanceof ApiFailure ? x.message : "Sign-in failed."); } finally { setBusy(false); }
  }
  return (
    <main className="shell narrow">
      <h1>TuitionBridge</h1>
      <ModeBadges config={config} />
      {config?.appMode === "sandbox" && <div className="sandbox-banner" role="note"><strong>SANDBOX · TEST DATA.</strong> Fictional users and providers; payments are simulated.</div>}
      <SetupBanner config={config} />
      <Card title={registering ? "Create your account" : live ? "Sign in" : "Sign in (sandbox test users)"}>
        <form className="form" onSubmit={submit}>
          <label className="field"><span>Email</span><input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" data-testid="email" /></label>
          {registering && <label className="field"><span>Your name</span><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" data-testid="display-name" /></label>}
          <label className="field"><span>Password{registering ? " (at least 10 characters)" : ""}</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={registering ? "new-password" : "current-password"} data-testid="password" /></label>
          {err && <p className="alert" role="alert">{err}</p>}
          <button className="btn btn-primary" disabled={busy} data-testid="login-btn">{registering ? "Create account" : "Sign in"}</button>
        </form>
        {live && (
          <p className="hint">
            {registering ? "Already registered? " : "New here? "}
            <button className="link" type="button" onClick={() => { setMode(registering ? "signin" : "register"); setErr(null); }} data-testid="toggle-register">{registering ? "Sign in" : "Create an account"}</button>
            . Your data stays in a local database on this computer.
          </p>
        )}
        {!live && <p className="hint">Sandbox test accounts are documented in the README. Everything here is fictional and payments are simulated.</p>}
      </Card>
    </main>
  );
}
