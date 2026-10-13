import { useState } from "react";
import { api, ApiFailure, type Invoice } from "./api";
import { Card } from "./components";

function toBase64(buf: ArrayBuffer): string {
  let s = "";
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export function ImportCard({ disabled, onImported, onError }: { disabled: boolean; onImported: (inv: Invoice) => void; onError: (m: string) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(body: { text?: string; pdfBase64?: string }) {
    setBusy(true);
    try {
      const inv = await api<Invoice>("POST", "/api/invoices/import", body);
      setText("");
      onImported(inv);
    } catch (e) { onError(e instanceof ApiFailure ? e.message : "Import failed."); } finally { setBusy(false); }
  }
  async function onFile(f: File | undefined) {
    if (!f) return;
    if (f.size > 300 * 1024) { onError("PDF is larger than 300 KB."); return; }
    await send({ pdfBase64: toBase64(await f.arrayBuffer()) });
  }

  return (
    <Card id="import" title="Add another invoice (text or text-PDF)">
      <label className="field">
        <span>Paste invoice text</span>
        <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={20000} placeholder={"Invoice No: ...\nRegistry ID: ...\nBeneficiary: ...\nAccount: KZ...\nAmount due: KZT ...\nDue date: 2026-10-14 09:48 +05:00"} data-testid="import-text" disabled={disabled || busy} />
      </label>
      <div className="actions">
        <button className="btn" onClick={() => send({ text })} disabled={disabled || busy || !text.trim()} data-testid="import-text-btn">Extract fields</button>
        <label className="btn file-btn">
          Upload text PDF
          <input type="file" accept="application/pdf" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} disabled={disabled || busy} data-testid="import-pdf" />
        </label>
      </div>
      <p className="hint">Extracted values are only a draft: you review and confirm them. Missing or ambiguous fields are never guessed, and bank details are never filled in for you. Scanned or image-only PDFs are not supported.</p>
    </Card>
  );
}
