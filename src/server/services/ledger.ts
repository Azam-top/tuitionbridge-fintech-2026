import type { Ctx } from "../ctx.js";

export interface AccountRow {
  id: string;
  owner_user_id: string | null;
  kind: string;
  currency: "USD" | "KZT";
  balance_minor: string;
  reserve_minor: string;
}

export interface Balances {
  usd: { accountId: string; balanceCents: string; reserveCents: string; availableCents: string };
  kzt: { accountId: string; balanceTiyn: string; reserveTiyn: string };
  note: string;
}

export function userAccount(ctx: Ctx, ownerId: string, currency: "USD" | "KZT"): AccountRow {
  const r = ctx.db.prepare("SELECT * FROM ledger_accounts WHERE owner_user_id = ? AND kind = 'user' AND currency = ?").get(ownerId, currency) as
    | AccountRow | undefined;
  if (!r) throw new Error(`missing ${currency} account for user`);
  return r;
}

export function getBalances(ctx: Ctx, ownerId: string): Balances {
  const usd = userAccount(ctx, ownerId, "USD");
  const kzt = userAccount(ctx, ownerId, "KZT");
  const avail = BigInt(usd.balance_minor) - BigInt(usd.reserve_minor);
  return {
    usd: {
      accountId: usd.id, balanceCents: usd.balance_minor, reserveCents: usd.reserve_minor,
      availableCents: (avail < 0n ? 0n : avail).toString(),
    },
    kzt: { accountId: kzt.id, balanceTiyn: kzt.balance_minor, reserveTiyn: kzt.reserve_minor },
    note: "Currencies are never summed. This sandbox scenario is funded from USD only; the student holds no KZT.",
  };
}

/** Sum of all account balances per currency; invariant: payments never change these totals. */
export function ledgerTotals(ctx: Ctx): { USD: bigint; KZT: bigint } {
  const rows = ctx.db.prepare("SELECT currency, balance_minor FROM ledger_accounts").all() as { currency: "USD" | "KZT"; balance_minor: string }[];
  const t = { USD: 0n, KZT: 0n };
  for (const r of rows) t[r.currency] += BigInt(r.balance_minor);
  return t;
}
