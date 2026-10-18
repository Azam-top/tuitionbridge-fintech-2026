import { useEffect, useState } from "react";
import { api, ApiFailure, type Invoice } from "./api";
import { Card, Chip, Row } from "./components";
import { fmtTime, formatKzt, kztToTiyn, tiynToInput, toLocalInput } from "./format";

const STATUS_TEXT: Record<Invoice["status"], { tone: "ok" | "warn" | "bad" | "info"; text: string }> = {
  DRAFT: { tone: "warn", text: "Needs your confirmation" },
  BLOCKED: { tone: "bad", text: "Blocked: needs correction" },
  CONFIRMED: { tone: "ok", text: "Confirmed by you" },
  INSTRUCTED: { tone: "info", text: "Payment instruction issued" },
  PAID: { tone: "info", text: "Paid (simulated)" },
};

interface Props {
  invoice: Invoice;
  locked: boolean; // a task is active: edits would invalidate it
  live: boolean; // live mode: the recipient is linked from the user's attested recipients, not typed
  onChanged: () => void;
  onError: (m: string) => void;
}

export function InvoiceCard({ invoice, locked, live, onChanged, onError }: Props) {
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState(() => toForm(invoice));
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!editing) setF(toForm(invoice)); }, [invoice, editing]);
  const st = STATUS_TEXT[invoice.status];

  async function save() {
    const tiyn = kztToTiyn(f.amount);
    if (!tiyn) { onError("Enter the amount as digits, for example 500000 or 500,000.50."); return; }
    if (!f.due || Number.isNaN(new Date(f.due).getTime())) { onError("Enter the deadline."); return; }
    setBusy(true);
    try {
      await api("PATCH", `/api/invoices/${invoice.id}`, {
        reference: f.reference, recipientRegistryId: f.registry, beneficiaryName: f.name, beneficiaryAccount: f.account,
        amountKztTiyn: tiyn, dueAt: new Date(f.due).toISOString(),
      });
      setEditing(false);
      onChanged();
    } catch (e) { onError(e instanceof ApiFailure ? e.message : "Could not save."); } finally { setBusy(false); }
  }
  async function confirm() {
    setBusy(true);
    try { await api("POST", `/api/invoices/${invoice.id}/confirm`); onChanged(); }
    catch (e) { onError(e instanceof ApiFailure ? e.message : "Could not confirm."); } finally { setBusy(false); }
  }

  return (
    <Card id="invoice" title={`Invoice ${invoice.reference}`} aside={<Chip tone={st.tone}>{st.text}</Chip>}>
      {!editing ? (
        <>
          <dl className="rows" data-testid="invoice-fields">
            <Row label="Beneficiary">{invoice.beneficiaryName}</Row>
            {live
              ? <Row label="Trusted recipient">{invoice.recipientRegistryId ? "Matched to a recipient you attested" : "Not matched to any recipient you attested"}</Row>
              : <Row label="Recipient registry ID">{invoice.recipientRegistryId}</Row>}
            <Row label="Beneficiary account"><code>{invoice.beneficiaryAccount}</code></Row>
            <Row label="Amount due" strong>{/^\d+$/.test(invoice.amountKztTiyn) ? formatKzt(invoice.amountKztTiyn) : "(missing)"}</Row>
            <Row label="Deadline">{invoice.dueAt ? fmtTime(invoice.dueAt) : "(missing)"}</Row>
            <Row label="Source">{invoice.sourceType.replace("_", " ")}</Row>
          </dl>
          {invoice.notes && (
            <div className="untrusted" data-testid="invoice-notes">
              <strong>Document notes (untrusted text; display only):</strong>
              <p>{invoice.notes}</p>
              <small>Instructions inside documents cannot waive approval, change the beneficiary, or grant any permission.</small>
            </div>
          )}
          {invoice.issues.length > 0 && (
            <ul className="issues" role="alert" data-testid="invoice-issues">
              {invoice.issues.map((i, k) => (<li key={k}><strong>{i.code.replace(/_/g, " ")}</strong>: {i.message}</li>))}
            </ul>
          )}
          {invoice.status !== "PAID" && invoice.status !== "INSTRUCTED" && (
            <div className="actions">
              <button className="btn" onClick={() => setEditing(true)} disabled={busy || locked} title={locked ? "Finish or cancel the active task before editing." : undefined}>Edit / correct</button>
              {invoice.status !== "CONFIRMED" && (
                <button className="btn btn-primary" onClick={confirm} disabled={busy || locked} data-testid="confirm-invoice">
                  {invoice.status === "BLOCKED" ? "Revalidate and confirm" : "These details are correct: confirm"}
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <form className="form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <Field label="Reference" value={f.reference} onChange={(v) => setF({ ...f, reference: v })} />
          {!live && <Field label="Recipient registry ID" value={f.registry} onChange={(v) => setF({ ...f, registry: v })} />}
          <Field label="Beneficiary name" value={f.name} onChange={(v) => setF({ ...f, name: v })} />
          <Field label="Beneficiary account" value={f.account} onChange={(v) => setF({ ...f, account: v })} />
          <Field label="Amount due (KZT)" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} inputMode="decimal" />
          <Field label="Deadline (your local time)" type="datetime-local" value={f.due} onChange={(v) => setF({ ...f, due: v })} />
          <p className="hint">Saving returns the invoice to "needs confirmation". Any earlier proposal or approval is discarded.</p>
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>Save corrections</button>
            <button type="button" className="btn" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
          </div>
        </form>
      )}
    </Card>
  );
}

function toForm(i: Invoice) {
  return { reference: i.reference, registry: i.recipientRegistryId, name: i.beneficiaryName, account: i.beneficiaryAccount, amount: tiynToInput(i.amountKztTiyn), due: toLocalInput(i.dueAt) };
}

function Field({ label, value, onChange, type = "text", inputMode }: { label: string; value: string; onChange: (v: string) => void; type?: string; inputMode?: "decimal" }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type={type} value={value} inputMode={inputMode} onChange={(e) => onChange(e.target.value)} required />
    </label>
  );
}
