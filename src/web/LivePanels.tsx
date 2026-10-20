import { useRef, useState } from "react";
import { api, ApiFailure, type Config, type Instruction, type Invoice, type Offer, type Recipient, type Reference, type Balances } from "./api";
import { Card, Chip, Row } from "./components";
import { fmtTime, formatKzt, formatUsd, kztToTiyn, tiynToInput } from "./format";
import { Icon } from "./icons";

/** The one fixed address the "Go to Wise" button opens. It is a constant: no offer, invoice or model text can change it. */
export const WISE_URL = "https://wise.com/";

const fail = (e: unknown, fallback: string) => (e instanceof ApiFailure ? e.message : fallback);

export const PROVENANCE_LABEL: Record<string, string> = {
  PROVIDER_LIVE: "Provider API (live)", USER_DECLARED: "Entered by you", SIMULATED: "Sandbox test data",
};

export function SetupBanner({ config }: { config: Config | null }) {
  if (!config || config.appMode !== "live" || config.agentStatus !== "NOT_CONFIGURED") return null;
  return (
    <section className="card setup" role="alert" data-testid="setup-banner">
      <h2>Setup required: no model is configured</h2>
      <p>The planning agent needs a real language model. This app has no stand-in agent in the live mode, so planning is disabled until you set one up.</p>
      <ol>
        <li>Copy <code>.env.example</code> to <code>.env</code>.</li>
        <li>Set <code>APP_LLM_API_KEY</code> (your own key) and <code>APP_LLM_MODEL</code> (a model id from your provider).</li>
        <li>Restart the app (<code>npm run start</code>).</li>
      </ol>
      <p className="muted small">Everything else (funds, recipients, invoice, offers) works without a model.</p>
    </section>
  );
}

export function FundsEditor({ balances, locked, onSaved, onError }: { balances: Balances; locked: boolean; onSaved: () => void; onError: (m: string) => void }) {
  const [bal, setBal] = useState(tiynToInput(balances.usd.balanceCents) || "0");
  const [res, setRes] = useState(tiynToInput(balances.usd.reserveCents) || "0");
  const [busy, setBusy] = useState(false);
  const empty = balances.usd.balanceCents === "0";
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try { await api("PUT", "/api/account/funds", { usdBalance: bal, usdReserve: res }); onSaved(); }
    catch (x) { onError(fail(x, "Could not save.")); } finally { setBusy(false); }
  }
  return (
    <details className="card tech" open={empty} data-testid="funds-editor">
      <summary>Your declared funds{empty ? " (set these first)" : ""}</summary>
      <form className="form" onSubmit={save}>
        <p className="muted small">Self-reported: the app does not read your bank. The reserve is the USD you keep for living costs. Each plan starts from this amount; you can change it for one plan, and the agent can never lower it.</p>
        <label className="field"><span>USD available to you</span><input inputMode="decimal" value={bal} onChange={(e) => setBal(e.target.value)} data-testid="funds-balance-input" disabled={locked} /></label>
        <label className="field"><span>USD to keep for living costs (your default for each plan)</span><input inputMode="decimal" value={res} onChange={(e) => setRes(e.target.value)} data-testid="funds-reserve-input" disabled={locked} /></label>
        <div className="actions"><button className="btn btn-primary" disabled={busy || locked} data-testid="funds-save">Save declared funds</button>{locked && <span className="muted small">Finish or cancel the active task first.</span>}</div>
      </form>
    </details>
  );
}

export function RecipientsCard({ recipients, onChanged, onError }: { recipients: Recipient[]; onChanged: () => void; onError: (m: string) => void }) {
  const [f, setF] = useState({ name: "", account: "", sourceUrl: "", sourceNote: "" });
  const [busy, setBusy] = useState(false);
  async function add(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try { await api("POST", "/api/recipients", f); setF({ name: "", account: "", sourceUrl: "", sourceNote: "" }); onChanged(); }
    catch (x) { onError(fail(x, "Could not add the recipient.")); } finally { setBusy(false); }
  }
  return (
    <details className="card tech" open={recipients.length === 0} data-testid="recipients-card">
      <summary>Trusted recipients ({recipients.length}){recipients.length === 0 ? ": add your university first" : ""}</summary>
      {recipients.length > 0 && (
        <ul className="plain" data-testid="recipient-list">
          {recipients.map((r) => (
            <li key={r.id}><strong>{r.name}</strong> · <code>{r.account}</code><br /><span className="muted small">Attested by you from <a href={r.sourceUrl ?? "#"} target="_blank" rel="noreferrer noopener">{r.sourceUrl}</a>: {r.sourceNote}</span></li>
          ))}
        </ul>
      )}
      <form className="form" onSubmit={add}>
        <p className="muted small">A recipient becomes trusted only when you add it here from the university's official payment page. An invoice cannot add or change one.</p>
        <label className="field"><span>Recipient name (exactly as on the official page)</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="recipient-name" /></label>
        <label className="field"><span>Account / IBAN</span><input value={f.account} onChange={(e) => setF({ ...f, account: e.target.value })} data-testid="recipient-account" /></label>
        <label className="field"><span>Official page address (https://…)</span><input value={f.sourceUrl} onChange={(e) => setF({ ...f, sourceUrl: e.target.value })} data-testid="recipient-url" /></label>
        <label className="field"><span>Where on that page, and when you copied it</span><input value={f.sourceNote} onChange={(e) => setF({ ...f, sourceNote: e.target.value })} data-testid="recipient-note" /></label>
        <div className="actions"><button className="btn btn-primary" disabled={busy} data-testid="recipient-add">Add trusted recipient</button></div>
      </form>
    </details>
  );
}

export function NewInvoiceCard({ recipients, defaultOpen = true, onCreated, onError }: { recipients: Recipient[]; defaultOpen?: boolean; onCreated: (inv: Invoice) => void; onError: (m: string) => void }) {
  const [f, setF] = useState({ reference: "", recipientId: "", amount: "", due: "" });
  const [busy, setBusy] = useState(false);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    const rec = recipients.find((r) => r.id === f.recipientId);
    const tiyn = kztToTiyn(f.amount);
    if (!rec) return onError("Choose a trusted recipient (add one first).");
    if (!tiyn) return onError("Enter the amount as digits, for example 500000 or 500,000.50.");
    if (!f.due || Number.isNaN(new Date(f.due).getTime())) return onError("Enter the deadline.");
    setBusy(true);
    try {
      const inv = await api<Invoice>("POST", "/api/invoices", {
        reference: f.reference, recipientRegistryId: "", beneficiaryName: rec.name, beneficiaryAccount: rec.account, amountKztTiyn: tiyn, dueAt: new Date(f.due).toISOString(), sourceType: "manual",
      });
      setF({ reference: "", recipientId: "", amount: "", due: "" });
      onCreated(inv);
    } catch (x) { onError(fail(x, "Could not create the invoice.")); } finally { setBusy(false); }
  }
  return (
    <details className="card tech" open={defaultOpen} data-testid="new-invoice">
      <summary>Enter an invoice by hand</summary>
      <form className="form" onSubmit={create}>
        <label className="field"><span>Invoice reference</span><input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} data-testid="invoice-ref" /></label>
        <label className="field"><span>Recipient (from your trusted recipients)</span>
          <select value={f.recipientId} onChange={(e) => setF({ ...f, recipientId: e.target.value })} data-testid="invoice-recipient">
            <option value="">Choose…</option>
            {recipients.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.account}</option>)}
          </select>
        </label>
        <label className="field"><span>Amount due (KZT)</span><input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} data-testid="invoice-amount" /></label>
        <label className="field"><span>Payment deadline (your local time)</span><input type="datetime-local" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} data-testid="invoice-due" /></label>
        <div className="actions"><button className="btn btn-primary" disabled={busy} data-testid="invoice-create">Create invoice</button></div>
        <p className="hint">Or use "Add an invoice" below to read a text PDF. Either way you review and confirm every field.</p>
      </form>
    </details>
  );
}

const bpsText = (b: number | null) => (b === null ? "" : `${b >= 0 ? "+" : ""}${(b / 100).toFixed(2)}% vs NBK reference`);

export function ReferenceLine({ reference }: { reference: Reference | null }) {
  if (!reference) return <p className="muted small" data-testid="reference-rate">Official NBK reference rate: not retrieved yet.</p>;
  return (
    <p className="muted small" data-testid="reference-rate">
      Official reference (National Bank of Kazakhstan): <strong className="num">{reference.rate} KZT per USD</strong>, effective {reference.effectiveDate}, retrieved {fmtTime(reference.retrievedAt)}
      {reference.stale ? " (stale)" : ""}. A guide only: it is not an offer, a fee or a delivery time.
    </p>
  );
}

/** Opens the optional manual-offer form and brings it into view (used by the "enter an offer yourself" action). */
export function openManualOffer(): void {
  const d = document.getElementById("manual-offer") as HTMLDetailsElement | null;
  if (!d) return;
  d.open = true;
  d.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  (d.querySelector("input") as HTMLElement | null)?.focus({ preventScroll: true });
}

export function OffersCard({ invoice, offers, reference, config, onChanged, onError }: {
  invoice: Invoice; offers: Offer[]; reference: Reference | null; config: Config; onChanged: () => void; onError: (m: string) => void;
}) {
  const now = new Date();
  const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [f, setF] = useState({ providerName: "", rate: "", feeUsd: "", arrivalAt: "", validUntil: local(new Date(now.getTime() + 30 * 60000)), observedAt: local(now), sourceNote: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ status: string; text: string } | null>(null);
  async function fetchWise() {
    setBusy(true); setMsg(null);
    try { const r = await api<{ result: { status: string; message: string } }>("POST", `/api/invoices/${invoice.id}/offers/refresh`); setMsg({ status: r.result.status, text: r.result.message }); onChanged(); }
    catch (x) { onError(fail(x, "Could not fetch quotes.")); } finally { setBusy(false); }
  }
  async function add(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      const iso = (v: string) => new Date(v).toISOString();
      await api("POST", `/api/invoices/${invoice.id}/offers`, { ...f, arrivalAt: iso(f.arrivalAt), validUntil: iso(f.validUntil), observedAt: iso(f.observedAt) });
      setF({ ...f, providerName: "", rate: "", feeUsd: "", arrivalAt: "", sourceNote: "" }); onChanged();
    } catch (x) { onError(fail(x, "Could not add the offer. Check every field.")); } finally { setBusy(false); }
  }
  return (
    <Card id="offers" title="Payment options and their sources">
      <div data-testid="offers-card">
        <p className="muted small">{config.wiseQuotes ? "Press “Plan my payment” and the server asks Wise for current quotes by itself. You can also refresh them here." : "Live Wise quotes are switched off in this setup, so offers come only from what you enter below."}</p>
        <ReferenceLine reference={reference} />
        <div className="actions">
          {config.wiseQuotes
            ? <button className="btn" onClick={fetchWise} disabled={busy} data-testid="fetch-wise"><Icon name={busy ? "clock" : "globe"} size={16} /> {busy ? "Asking Wise…" : offers.length ? "Refresh Wise quotes" : "Get Wise quotes now"}</button>
            : <span className="muted small">Live Wise quotes are switched off (set APP_WISE_QUOTES=1). You can still enter offers you were given.</span>}
          {msg && (
            <span role="status" className={msg.status === "OK" ? "small ok-text" : "small warn-text"} data-testid="offers-message">
              <Icon name={msg.status === "OK" ? "check" : "alert"} size={14} /> {msg.text}{msg.status !== "OK" ? " Source problem: nothing was invented." : ""}
            </span>
          )}
        </div>
        {offers.length === 0 ? <p className="muted" data-testid="no-offers">No offers yet. They appear here once the planner has asked Wise, or when you add one from your bank. The app never invents an offer.</p> : (
          <ul className="plain" data-testid="offer-list">
            {offers.map((o) => (
              <li key={o.id} className={o.expired ? "expired" : ""}>
                <strong>{o.providerName}</strong> <Chip tone={o.provenance === "PROVIDER_LIVE" ? "info" : "warn"}>{PROVENANCE_LABEL[o.provenance] ?? o.provenance}</Chip> {o.expired && <Chip tone="bad">expired</Chip>}
                <br /><span className="num">{o.rate} KZT per USD</span> · fee <span className="num">{formatUsd(o.feeCents)}</span> · arrives about {fmtTime(o.estArrivalAt)} · valid until {fmtTime(o.expiresAt)}
                {o.deviationBps !== null && <span className="muted small"> · {bpsText(o.deviationBps)}</span>}
                <br /><span className="muted small">{o.sourceNote ?? "source note unknown"}{o.observedAt ? ` (seen ${fmtTime(o.observedAt)})` : " (observation time unknown)"}</span>
              </li>
            ))}
          </ul>
        )}
        <details className="inline-details" id="manual-offer" data-testid="manual-offer">
          <summary>Optional: add an offer you were given by your bank or provider</summary>
          <form className="form" onSubmit={add}>
            <label className="field"><span>Provider or bank</span><input value={f.providerName} onChange={(e) => setF({ ...f, providerName: e.target.value })} data-testid="offer-provider" /></label>
            <label className="field"><span>Rate (KZT per 1 USD)</span><input inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} data-testid="offer-rate" /></label>
            <label className="field"><span>Total fixed fee (USD)</span><input inputMode="decimal" value={f.feeUsd} onChange={(e) => setF({ ...f, feeUsd: e.target.value })} data-testid="offer-fee" /></label>
            <label className="field"><span>Expected arrival (your local time)</span><input type="datetime-local" value={f.arrivalAt} onChange={(e) => setF({ ...f, arrivalAt: e.target.value })} data-testid="offer-arrival" /></label>
            <label className="field"><span>Offer valid until</span><input type="datetime-local" value={f.validUntil} onChange={(e) => setF({ ...f, validUntil: e.target.value })} data-testid="offer-valid" /></label>
            <label className="field"><span>When you saw it</span><input type="datetime-local" value={f.observedAt} onChange={(e) => setF({ ...f, observedAt: e.target.value })} data-testid="offer-seen" /></label>
            <label className="field"><span>Where it came from (for example: Bank app quote screen)</span><input value={f.sourceNote} onChange={(e) => setF({ ...f, sourceNote: e.target.value })} data-testid="offer-note" /></label>
            <div className="actions"><button className="btn btn-primary" disabled={busy} data-testid="offer-add">Add offer</button></div>
            <p className="hint">If the provider charges a percentage, enter the total fee in USD for this exact amount.</p>
          </form>
        </details>
      </div>
    </Card>
  );
}

const toBase64 = (buf: ArrayBuffer): string => {
  let s = ""; const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

export function InstructionCard({ instruction: ins, onChanged, onError }: { instruction: Instruction; onChanged: () => void; onError: (m: string) => void }) {
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const b = ins.body;
  const run = async (fn: () => Promise<unknown>, msg: string) => { setBusy(true); try { await fn(); onChanged(); } catch (x) { onError(fail(x, msg)); } finally { setBusy(false); } };
  const cancelled = ins.status === "CANCELLED";
  return (
    <Card id="instruction-card" title="Payment instruction" aside={<Chip tone={cancelled ? "muted" : "warn"}>{cancelled ? "Cancelled" : "You pay outside the app"}</Chip>}>
      <div data-testid="instruction-card">
        <p className="agent-says" data-testid="instruction-status"><strong>Status:</strong> {ins.progressLabel}</p>
        <dl className="rows">
          <Row label="Pay to">{b.payTo.name}</Row>
          <Row label="Account"><code data-testid="instruction-account">{b.payTo.account}</code></Row>
          <Row label="Payment reference">{b.invoiceReference}</Row>
          <Row label="You pay in total" strong><span className="num" data-testid="instruction-total">{formatUsd(b.youPayUsdCents)}</span></Row>
          <Row label="Of which provider fee"><span className="num">{formatUsd(b.providerFeeUsdCents)}</span></Row>
          <Row label="Rate"><span className="num">{b.rate} KZT per USD</span></Row>
          <Row label="University should receive"><span className="num">{formatKzt(b.universityShouldReceiveTiyn)}</span></Row>
          <Row label="Start paying before (offer validity)">{fmtTime(b.mustStartPaymentBefore)}</Row>
          <Row label="Invoice deadline">{fmtTime(b.invoiceDeadline)}</Row>
          <Row label="Estimated arrival (an estimate)">{fmtTime(b.estimatedArrival)}</Row>
          <Row label="Offer source">{PROVENANCE_LABEL[b.source.provenance] ?? b.source.provenance}{b.source.observedAt ? `, seen ${fmtTime(b.source.observedAt)}` : ""}{b.source.note ? `: ${b.source.note}` : ""}</Row>
        </dl>
        {!cancelled && b.source.provenance === "PROVIDER_LIVE" && /^wise\b/i.test(b.provider) && (
          <div className="handoff" data-testid="wise-handoff">
            <a className="btn btn-primary btn-lg" href={WISE_URL} target="_blank" rel="noopener noreferrer" data-testid="go-to-wise">
              Go to Wise <Icon name="arrowRight" size={18} />
            </a>
            <p className="muted small">Finish the payment on Wise. It opens wise.com in a new tab; this app cannot pay for you.</p>
          </div>
        )}
        <h3>What to do</h3>
        <ol>{b.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        {ins.evidence.length > 0 && (
          <ul className="plain" data-testid="evidence-list">
            {ins.evidence.map((e) => (
              <li key={e.id}><strong>{e.kind === "user_marked_paid" ? "Marked paid by you" : "Confirmation file"}</strong> · {fmtTime(e.createdAt)}{e.reference ? ` · reference ${e.reference}` : ""}{e.filename ? ` · ${e.filename}` : ""}
                <br /><span className="muted small">{e.label}{e.sha256 ? ` SHA-256 ${e.sha256.slice(0, 16)}…` : ""}</span></li>
            ))}
          </ul>
        )}
        {!cancelled && (
          <div className="actions">
            <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Payment reference from your bank (optional)" aria-label="Payment reference" style={{ maxWidth: 320 }} />
            <button className="btn" disabled={busy || ins.evidence.some((e) => e.kind === "user_marked_paid")} onClick={() => run(() => api("POST", `/api/instructions/${ins.id}/mark-paid`, ref ? { reference: ref } : {}), "Could not record this.")} data-testid="mark-paid">I paid (mark as paid; not verified)</button>
            <label className="btn file-btn">
              Upload bank confirmation (PDF, PNG, JPEG)
              <input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg" hidden data-testid="upload-confirmation" disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0]; e.target.value = "";
                  if (!file) return;
                  void run(async () => api("POST", `/api/instructions/${ins.id}/confirmation`, { filename: file.name, dataBase64: toBase64(await file.arrayBuffer()), ...(ref ? { reference: ref } : {}) }), "Could not upload the file.");
                }} />
            </label>
            {ins.evidence.length === 0 && <button className="btn" disabled={busy} onClick={() => run(() => api("POST", `/api/instructions/${ins.id}/cancel`), "Could not cancel.")} data-testid="cancel-instruction">Cancel this instruction</button>}
          </div>
        )}
        <p className="hint">The app does not move money and cannot see your bank. Anything you mark or upload is stored as your own evidence and is never treated as verified.</p>
      </div>
    </Card>
  );
}
