import type { Ctx } from "../ctx.js";
import { DYNAMIC_TABLES } from "../db.js";
import { hashPassword } from "../auth.js";
import { newId } from "../ids.js";
import {
  DEMO_DEADLINE_HOURS, DEMO_KZT_BALANCE_TIYN, DEMO_TUITION_TIYN, DEMO_USERS, DEMO_USD_BALANCE_CENTS,
  DEMO_USD_BALANCE_INSUFFICIENT_CENTS, DEMO_USD_RESERVE_CENTS, MALICIOUS_NOTES, TRUSTED_RECIPIENTS, type ScenarioId,
} from "../fixtures.js";

// Password hashing is slow by design; hash once per process per user.
const hashCache = new Map<string, string>();
const hashFor = (pw: string) => {
  let h = hashCache.get(pw);
  if (!h) hashCache.set(pw, (h = hashPassword(pw)));
  return h;
};

export interface SeedOptions {
  /** Scenario applied to the given user; every other demo user gets `standard`. */
  scenarioFor?: { userId: string; scenario: ScenarioId };
}

/**
 * Wipes ALL dynamic data and rebuilds the synthetic demo dataset.
 * Dates are relative to the injected clock, so the deadline is always now + 48h at reset time.
 * Quotes expire in minutes; the agent re-issues them when it runs.
 */
export function resetDemo(ctx: Ctx, opts: SeedOptions = {}): void {
  const { db, clock } = ctx;
  const now = clock.now();
  const nowIso = now.toISOString();
  const due = new Date(now.getTime() + DEMO_DEADLINE_HOURS * 3600_000).toISOString();
  const keptSessions = db.prepare("SELECT * FROM sessions").all() as Record<string, string>[];
  db.transaction(() => {
    db.pragma("foreign_keys = OFF");
    for (const t of DYNAMIC_TABLES) db.prepare(`DELETE FROM ${t}`).run();
    db.pragma("foreign_keys = ON");
    for (const r of TRUSTED_RECIPIENTS) {
      db.prepare("INSERT INTO trusted_recipients (registry_id, name, account) VALUES (?,?,?)").run(r.registryId, r.name, r.account);
    }
    db.prepare("INSERT INTO ledger_accounts (id, owner_user_id, kind, currency, balance_minor) VALUES ('acc_uni_kzt', NULL, 'university', 'KZT', '0')").run();
    db.prepare("INSERT INTO ledger_accounts (id, owner_user_id, kind, currency, balance_minor) VALUES ('acc_settle_usd', NULL, 'settlement', 'USD', '0')").run();
    db.prepare("INSERT INTO ledger_accounts (id, owner_user_id, kind, currency, balance_minor) VALUES ('acc_settle_kzt', NULL, 'settlement', 'KZT', '0')").run();
    for (const u of DEMO_USERS) {
      const scenario: ScenarioId = opts.scenarioFor?.userId === u.id ? opts.scenarioFor.scenario : "standard";
      db.prepare("INSERT INTO users (id, email, display_name, password_hash, max_tier, scenario) VALUES (?,?,?,?,?,?)").run(
        u.id, u.email, u.displayName, hashFor(u.password), u.maxTier, scenario,
      );
      const usd = scenario === "insufficient" ? DEMO_USD_BALANCE_INSUFFICIENT_CENTS : DEMO_USD_BALANCE_CENTS;
      db.prepare("INSERT INTO ledger_accounts (id, owner_user_id, kind, currency, balance_minor, reserve_minor) VALUES (?,?,?,?,?,?)").run(
        `acc_${u.id}_usd`, u.id, "user", "USD", usd, DEMO_USD_RESERVE_CENTS,
      );
      db.prepare("INSERT INTO ledger_accounts (id, owner_user_id, kind, currency, balance_minor, reserve_minor) VALUES (?,?,?,?,?,?)").run(
        `acc_${u.id}_kzt`, u.id, "user", "KZT", DEMO_KZT_BALANCE_TIYN, "0",
      );
      const t = TRUSTED_RECIPIENTS[0];
      const mismatch = scenario === "recipient_mismatch";
      db.prepare(
        `INSERT INTO invoices (id, owner_user_id, reference, recipient_registry_id, beneficiary_name, beneficiary_account,
           amount_kzt_tiyn, due_at, source_type, notes, status, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        newId("inv"), u.id, "INV-2026-0417", t.registryId, t.name,
        mismatch ? "KZ99ATTACKER0000000001" : t.account,
        DEMO_TUITION_TIYN, due, "synthetic_example",
        scenario === "malicious" ? MALICIOUS_NOTES : "Autumn semester tuition (synthetic example).", "DRAFT", nowIso,
      );
    }
    // Keep logged-in sessions alive across a demo reset (user ids are stable).
    for (const s of keptSessions) {
      db.prepare("INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at) VALUES (?,?,?,?,?)").run(
        s.token_hash, s.user_id, s.csrf_token, s.created_at, s.expires_at,
      );
    }
  })();
}
