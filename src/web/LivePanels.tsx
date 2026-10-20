import { useRef, useState } from "react";
import { api, ApiFailure, type Config, type Instruction, type Invoice, type Offer, type Recipient, type Reference, type Balances } from "./api";
import { Card, Chip, Row } from "./components";
import { fmtTime, formatKzt, formatUsd, kztToTiyn, tiynToInput } from "./format";
import { Icon } from "./icons";
import { clockTime, providerParts, sourceDetail, SOURCE_NAME } from "./plan";

/** The one fixed address the "Continue on Wise" button opens. It is a constant: no offer, invoice or model text can change it. */
export const WISE_URL = "https://wise.com/";

const fail = (e: unknown, fallback: string) => (e instanceof ApiFailure ? e.message : fallback);

/** Plain names for where an option came from. The technical wording lives in the closed Details. */
export const PROVENANCE_LABEL: Record<string, string> = SOURCE_NAME;

export function SetupBanner({ config }: { config: Config | null }) {
  if (!config || config.appMode !== "live" || config.agentStatus !== "NOT_CONFIGURED") return null;
  return (
    <section className="card setup" role="alert" data-testid="setup-banner">
      <h2>Setup required</h2>
      <p>Planning needs an AI model. Add your key and model name, then restart.</p>
      <ol>
        <li>Copy <code>.env.example</code> to <code>.env</code>.</li>
        <li>Fill in <code>APP_LLM_PROVIDER</code>, <code>APP_LLM_API_KEY</code> and <code>APP_LLM_MODEL</code>.</li>
        <li>Restart the app (<code>npm run start</code>).</li>
      </ol>
      <p className="muted small">Funds, university account, invoice and offers work without it.</p>
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
      <summary>Funds and reserve{empty ? " (start here)" : ""}</summary>
      <form className="form" onSubmit={save}>
        <p className="muted small">Entered by you; TuitionBridge does not read your bank. Each plan starts from this reserve.</p>
        <label className="field"><span>USD you have</span><input inputMode="decimal" value={bal} onChange={(e) => setBal(e.target.value)} data-testid="funds-balance-input" disabled={locked} /></label>
        <label className="field"><span>Living reserve (USD)</span><input inputMode="decimal" value={res} onChange={(e) => setRes(e.target.value)} data-testid="funds-reserve-input" disabled={locked} /></label>
        <div className="actions"><button className="btn btn-primary" disabled={busy || locked} data-testid="funds-save">Save</button>{locked && <span className="muted small">Finish or cancel the current plan to change this.</span>}</div>
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
    catch (x) { onError(fail(x, "Could not add the university.")); } finally { setBusy(false); }
  }
  return (
    <details className="card tech" open={recipients.length === 0} data-testid="recipients-card">
      <summary>University account ({recipients.length}){recipients.length === 0 ? ": add it first" : ""}</summary>
      {recipients.length > 0 && (
        <ul className="plain" data-testid="recipient-list">
          {recipients.map((r) => (
            <li key={r.id}>
              <strong>{r.name}</strong> · <code>{r.account}</code>
              <br /><span className="muted small">Added by you from {r.sourceUrl ? <a href={r.sourceUrl} target="_blank" rel="noreferrer noopener">the official payment page</a> : "the official payment page"}</span>
            </li>
          ))}
        </ul>
      )}
      <form className="form" onSubmit={add}>
        <p className="muted small">Copy the name and account from your university's official payment page. Invoices can never change them.</p>
        <label className="field"><span>Recipient name (as on the official page)</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="recipient-name" /></label>
        <label className="field"><span>Account / IBAN</span><input value={f.account} onChange={(e) => setF({ ...f, account: e.target.value })} data-testid="recipient-account" /></label>
        <label className="field"><span>Official page address (https://…)</span><input value={f.sourceUrl} onChange={(e) => setF({ ...f, sourceUrl: e.target.value })} data-testid="recipient-url" /></label>
        <label className="field"><span>Where on that page, and when you copied it</span><input value={f.sourceNote} onChange={(e) => setF({ ...f, sourceNote: e.target.value })} data-testid="recipient-note" /></label>
        <div className="actions"><button className="btn btn-primary" disabled={busy} data-testid="recipient-add">Save university account</button></div>
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
    if (!rec) return onError("Choose the university account first (add it above if it is missing).");
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
      <summary>Enter an invoice</summary>
      <form className="form" onSubmit={create}>
        <label className="field"><span>Invoice reference</span><input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} data-testid="invoice-ref" /></label>
        <label className="field"><span>University account</span>
          <select value={f.recipientId} onChange={(e) => setF({ ...f, recipientId: e.target.value })} data-testid="invoice-recipient">
            <option value="">Choose…</option>
            {recipients.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.account}</option>)}
          </select>
        </label>
        <label className="field"><span>Amount due (KZT)</span><input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} data-testid="invoice-amount" /></label>
        <label className="field"><span>Payment deadline (your local time)</span><input type="datetime-local" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} data-testid="invoice-due" /></label>
        <div className="actions"><button className="btn btn-primary" disabled={busy} data-testid="invoice-create">Create invoice</button></div>
      </form>
    </details>
  );
}

const bpsText = (b: number | null) => (b === null ? "" : `${b >= 0 ? "+" : ""}${(b / 100).toFixed(2)}% vs the National Bank reference`);

export function ReferenceLine({ reference }: { reference: Reference | null }) {
  if (!reference) return <p className="muted small" data-testid="reference-rate">National Bank of Kazakhstan reference rate: not retrieved yet.</p>;
  return (
    <p className="muted small" data-testid="reference-rate">
      National Bank of Kazakhstan reference: <strong className="num">{reference.rate} KZT per USD</strong>, effective {reference.effectiveDate}{reference.stale ? " (stale)" : ""}. A guide, not an offer.
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

function OfferCard({ o }: { o: Offer }) {
  const { title, method } = providerParts(o.providerName);
  return (
    <li className={`offer${o.expired ? " expired" : ""}`}>
      <div className="offer-top">
        <span className="offer-name"><strong>{title}</strong>{method && <span className="muted"> · {method}</span>}</span>
        {o.expired && <Chip tone="bad">Expired</Chip>}
        <strong className="num offer-total">{o.totalDebitCents ? formatUsd(o.totalDebitCents) : "n/a"}</strong>
      </div>
      <dl className="offer-facts">
        <div><dt>Fee</dt><dd className="num">{formatUsd(o.feeCents)}</dd></div>
        <div><dt>University gets</dt><dd className="num">{o.recipientTiyn ? formatKzt(o.recipientTiyn) : "n/a"}</dd></div>
        <div><dt>Arrives</dt><dd>{fmtTime(o.estArrivalAt)}</dd></div>
        <div><dt>Valid until</dt><dd>{o.expired ? "expired" : clockTime(o.expiresAt)}</dd></div>
      </dl>
      <details className="offer-details">
        <summary>Details</summary>
        <p className="muted small">{sourceDetail(o.provenance, o.sourceNote, o.observedAt)}</p>
        <p className="muted small num">Rate shown: {o.rate} KZT per USD{o.deviationBps !== null ? ` · ${bpsText(o.deviationBps)}` : ""}</p>
        {o.provenance === "USER_DECLARED" && <p className="muted small">You entered this offer; TuitionBridge cannot check it with the bank.</p>}
      </details>
    </li>
  );
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
    try { const r = await api<{ result: { status: string; message: string } }>("POST", `/api/invoices/${invoice.id}/offers/refresh`); setMsg({ status: r.result.status, text: r.result.status === "OK" ? "Quotes updated." : "Could not load Wise quotes. Try again, or add your bank's offer below." }); onChanged(); }
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
  const wiseSeen = offers.filter((o) => o.provenance === "PROVIDER_LIVE" && o.observedAt).map((o) => o.observedAt as string).sort().pop();
  return (
    <Card id="offers" title="Transfer options">
      <div data-testid="offers-card">
        <div className="actions offers-bar">
          {wiseSeen && <span className="muted small" data-testid="offers-updated">Wise · updated {clockTime(wiseSeen)}</span>}
          {!wiseSeen && config.wiseQuotes && offers.length === 0 && <span className="muted small">Wise quotes load when you plan your payment.</span>}
          {!config.wiseQuotes && <span className="muted small">Wise quotes are off. Add your bank's offer below.</span>}
          {config.wiseQuotes && (
            <button className="btn" onClick={fetchWise} disabled={busy} data-testid="fetch-wise"><Icon name={busy ? "clock" : "globe"} size={16} /> {busy ? "Updating…" : offers.length ? "Refresh quotes" : "Get quotes now"}</button>
          )}
          {msg && (
            <span role="status" className={msg.status === "OK" ? "small ok-text" : "small warn-text"} data-testid="offers-message">
              <Icon name={msg.status === "OK" ? "check" : "alert"} size={14} /> {msg.text}
            </span>
          )}
        </div>
        {offers.length === 0 ? <p className="muted" data-testid="no-offers">No options yet.</p> : (
          <ul className="plain offer-list" data-testid="offer-list">
            {offers.map((o) => <OfferCard key={o.id} o={o} />)}
          </ul>
        )}
        <details className="inline-details" id="manual-offer" data-testid="manual-offer">
          <summary>Add an offer from your bank (optional)</summary>
          <form className="form" onSubmit={add}>
            <label className="field"><span>Bank or provider</span><input value={f.providerName} onChange={(e) => setF({ ...f, providerName: e.target.value })} data-testid="offer-provider" /></label>
            <label className="field"><span>Rate (KZT per 1 USD)</span><input inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} data-testid="offer-rate" /></label>
            <label className="field"><span>Total fee (USD)</span><input inputMode="decimal" value={f.feeUsd} onChange={(e) => setF({ ...f, feeUsd: e.target.value })} data-testid="offer-fee" /></label>
            <label className="field"><span>Expected arrival (your local time)</span><input type="datetime-local" value={f.arrivalAt} onChange={(e) => setF({ ...f, arrivalAt: e.target.value })} data-testid="offer-arrival" /></label>
            <label className="field"><span>Offer valid until</span><input type="datetime-local" value={f.validUntil} onChange={(e) => setF({ ...f, validUntil: e.target.value })} data-testid="offer-valid" /></label>
            <label className="field"><span>When you saw it</span><input type="datetime-local" value={f.observedAt} onChange={(e) => setF({ ...f, observedAt: e.target.value })} data-testid="offer-seen" /></label>
            <label className="field"><span>Where it came from (for example: bank app quote screen)</span><input value={f.sourceNote} onChange={(e) => setF({ ...f, sourceNote: e.target.value })} data-testid="offer-note" /></label>
            <div className="actions"><button className="btn btn-primary" disabled={busy} data-testid="offer-add">Add offer</button></div>
            <p className="hint">If a percentage fee applies, enter the total fee in USD for this amount.</p>
          </form>
        </details>
        <details className="inline-details" data-testid="sources-details">
          <summary>Sources</summary>
          <ReferenceLine reference={reference} />
          <p className="muted small">Wise amounts are exactly as Wise quoted them and can change; they are not guaranteed.</p>
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

const STATUS_LINE: Record<Instruction["progress"], string> = {
  INSTRUCTION_ISSUED: "Instruction ready. Not paid yet.",
  MARKED_PAID_BY_USER: "You marked this as paid. A bank has not confirmed it.",
  CONFIRMATION_FILE_UPLOADED: "You attached a confirmation file. A bank has not confirmed it.",
  CANCELLED: "Instruction cancelled.",
};

export function InstructionCard({ instruction: ins, nowMs, onChanged, onError }: { instruction: Instruction; nowMs: number; onChanged: () => void; onError: (m: string) => void }) {
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const b = ins.body;
  const run = async (fn: () => Promise<unknown>, msg: string) => { setBusy(true); try { await fn(); onChanged(); } catch (x) { onError(fail(x, msg)); } finally { setBusy(false); } };
  const cancelled = ins.status === "CANCELLED";
  const isWise = b.source.provenance === "PROVIDER_LIVE" && /^wise\b/i.test(b.provider);
  const expired = Date.parse(b.mustStartPaymentBefore) <= nowMs;
  const { title: providerTitle } = providerParts(b.provider);
  const total = formatUsd(b.youPayUsdCents);
  const steps = [
    isWise ? "Continue on Wise and start a USD to KZT transfer." : `Open ${providerTitle}, the channel that gave you this offer.`,
    `Pay exactly ${total} to ${b.payTo.name}, account ${b.payTo.account}, reference ${b.invoiceReference}.`,
    "Check that the total and the recipient amount match this page. If they differ, or the offer has expired, plan again.",
    "Keep your confirmation. You can attach it below (optional).",
  ];
  return (
    <Card id="instruction-card" title="Your payment instruction" aside={<Chip tone={cancelled ? "muted" : expired ? "bad" : "warn"}>{cancelled ? "Cancelled" : expired ? "Offer expired" : "Not paid yet"}</Chip>}>
      <div data-testid="instruction-card">
        <p className="agent-says" data-testid="instruction-status">{STATUS_LINE[ins.progress]}</p>
        {!cancelled && expired && (
          <p className="alert" role="alert" data-testid="instruction-expired"><Icon name="clock" size={18} /> This offer has expired. Plan again to get a current price before you pay.</p>
        )}
        {!cancelled && !expired && isWise && (
          <div className="handoff" data-testid="wise-handoff">
            <a className="btn btn-primary btn-lg" href={WISE_URL} target="_blank" rel="noopener noreferrer" data-testid="go-to-wise">
              Continue on Wise <Icon name="arrowRight" size={18} />
            </a>
            <p className="muted small">Complete your payment on Wise.</p>
          </div>
        )}
        <dl className="rows">
          <Row label="Pay to">{b.payTo.name}</Row>
          <Row label="Account"><code data-testid="instruction-account">{b.payTo.account}</code></Row>
          <Row label="Reference">{b.invoiceReference}</Row>
          <Row label="You pay" strong><span className="num" data-testid="instruction-total">{total}</span> <small className="muted">incl. {formatUsd(b.providerFeeUsdCents)} fee</small></Row>
          <Row label="University will receive"><span className="num">{formatKzt(b.universityShouldReceiveTiyn)}</span></Row>
          <Row label="Offer valid until">{fmtTime(b.mustStartPaymentBefore)}</Row>
          <Row label="Expected arrival">{fmtTime(b.estimatedArrival)}</Row>
          <Row label="Invoice deadline">{fmtTime(b.invoiceDeadline)}</Row>
        </dl>
        <h3>What to do</h3>
        <ol>{steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        {ins.evidence.length > 0 && (
          <ul className="plain" data-testid="evidence-list">
            {ins.evidence.map((e) => (
              <li key={e.id}>
                <strong>{e.kind === "user_marked_paid" ? "Marked by you" : "Confirmation file"}</strong> · {fmtTime(e.createdAt)}{e.reference ? ` · reference ${e.reference}` : ""}{e.filename ? ` · ${e.filename}` : ""}
                <br /><span className="muted small">Your own record. A bank has not confirmed it.</span>
              </li>
            ))}
          </ul>
        )}
        {!cancelled && (
          <div className="actions">
            <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Payment reference (optional)" aria-label="Payment reference" style={{ maxWidth: 260 }} />
            <button className="btn" disabled={busy || ins.evidence.some((e) => e.kind === "user_marked_paid")} onClick={() => run(() => api("POST", `/api/instructions/${ins.id}/mark-paid`, ref ? { reference: ref } : {}), "Could not record this.")} data-testid="mark-paid">I've made the payment</button>
            <label className="btn file-btn">
              Attach confirmation
              <input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg" hidden data-testid="upload-confirmation" disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0]; e.target.value = "";
                  if (!file) return;
                  void run(async () => api("POST", `/api/instructions/${ins.id}/confirmation`, { filename: file.name, dataBase64: toBase64(await file.arrayBuffer()), ...(ref ? { reference: ref } : {}) }), "Could not attach the file. Use a PDF, PNG or JPEG under 2 MB.");
                }} />
            </label>
            {ins.evidence.length === 0 && <button className="btn" disabled={busy} onClick={() => run(() => api("POST", `/api/instructions/${ins.id}/cancel`), "Could not cancel.")} data-testid="cancel-instruction">Cancel instruction</button>}
          </div>
        )}
        <details className="inline-details" data-testid="instruction-details">
          <summary>Details</summary>
          <p className="muted small">{sourceDetail(b.source.provenance, b.source.note, b.source.observedAt)}</p>
          <p className="muted small num">Rate shown: {b.rate} KZT per USD</p>
          <p className="muted small">TuitionBridge cannot see your bank. Anything you mark or attach is your own record.</p>
          <code className="hash">{ins.hash}</code>
        </details>
      </div>
    </Card>
  );
}
