import type { Db } from "../db.js";
import type { Clock } from "../clock.js";
import { newId } from "../ids.js";

export interface AuditInput {
  ownerUserId: string | null;
  taskId?: string | null;
  mode?: string | null;
  event: string;
  result: "ALLOWED" | "REJECTED" | "INFO" | "ERROR";
  refs?: Record<string, string | number | boolean | null>;
}

// Redacted, structured fields only: ids, codes, hashes. Never credentials, document text or personal data.
export function audit(db: Db, clock: Clock, e: AuditInput): void {
  db.prepare("INSERT INTO audit_events (id, ts, owner_user_id, task_id, mode, event, result, refs_json) VALUES (?,?,?,?,?,?,?,?)").run(
    newId("aud"), clock.now().toISOString(), e.ownerUserId, e.taskId ?? null, e.mode ?? null, e.event, e.result, JSON.stringify(e.refs ?? {}),
  );
}
