import { z } from "zod";
import type { Ctx } from "../ctx.js";
import { hashPassword } from "../auth.js";
import { newId } from "../ids.js";
import { PolicyError } from "../errors.js";
import { decimalToMinor } from "../../shared/money.js";
import { audit } from "./audit.js";
import { parseInput } from "./invoices.js";

const RegisterInput = z.object({
  email: z.string().trim().toLowerCase().max(200).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Enter a valid email address."),
  displayName: z.string().trim().min(1).max(80),
  password: z.string().min(10, "Use at least 10 characters.").max(200),
}).strict();

/** Live mode only: creates a real account. There are no seeded users in the live database. */
export function registerUser(ctx: Ctx, raw: unknown): { userId: string } {
  if (ctx.config.appMode !== "live") throw new PolicyError("WRONG_MODE", "Registration exists only in the live mode; the sandbox uses its own labeled test users.");
  const v = parseInput(RegisterInput, raw);
  if (ctx.db.prepare("SELECT 1 FROM users WHERE email = ?").get(v.email)) throw new PolicyError("VALIDATION", "An account with this email already exists.");
  const id = newId("usr");
  const hash = hashPassword(v.password);
  ctx.db.transaction(() => {
    ctx.db.prepare("INSERT INTO users (id, email, display_name, password_hash, max_tier) VALUES (?,?,?,?,'execute')").run(id, v.email, v.displayName, hash);
    for (const ccy of ["USD", "KZT"] as const) {
      ctx.db.prepare("INSERT INTO ledger_accounts (id, owner_user_id, kind, currency, balance_minor, reserve_minor) VALUES (?,?,?,?,?,?)").run(`acc_${id}_${ccy.toLowerCase()}`, id, "user", ccy, "0", "0");
    }
  })();
  audit(ctx.db, ctx.clock, { ownerUserId: id, event: "account.registered", result: "ALLOWED" });
  return { userId: id };
}

const FundsInput = z.object({ usdBalance: z.string().max(20), usdReserve: z.string().max(20) }).strict();

/**
 * The user declares their available USD and the living-expense reserve. The app does not read any bank: these numbers are
 * self-reported and are shown as such. They cannot change while a task is running.
 */
export function declareFunds(ctx: Ctx, ownerId: string, raw: unknown): { usdBalanceCents: string; usdReserveCents: string } {
  const v = parseInput(FundsInput, raw);
  let balance: bigint; let reserve: bigint;
  try { balance = decimalToMinor(v.usdBalance, "USD balance"); reserve = decimalToMinor(v.usdReserve, "Reserve"); }
  catch (e) { throw new PolicyError("VALIDATION", e instanceof Error ? e.message : "Invalid amount."); }
  const active = ctx.db.prepare("SELECT 1 FROM agent_tasks WHERE owner_user_id = ? AND state IN ('RUNNING','AWAITING_APPROVAL','EXECUTING')").get(ownerId);
  if (active) throw new PolicyError("TASK_ACTIVE", "Finish or cancel the active payment task before changing your declared funds.");
  ctx.db.transaction(() => {
    ctx.db.prepare("UPDATE ledger_accounts SET balance_minor = ?, reserve_minor = ? WHERE owner_user_id = ? AND kind = 'user' AND currency = 'USD'").run(balance.toString(), reserve.toString(), ownerId);
    // Any open proposal was computed from the old numbers.
    ctx.db.prepare("UPDATE proposals SET status = 'SUPERSEDED' WHERE owner_user_id = ? AND status = 'PENDING'").run(ownerId);
  })();
  audit(ctx.db, ctx.clock, { ownerUserId: ownerId, event: "account.funds_declared", result: "INFO", refs: { source: "user_declared" } });
  return { usdBalanceCents: balance.toString(), usdReserveCents: reserve.toString() };
}
