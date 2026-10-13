import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import type { Db } from "./db.js";
import type { Clock } from "./clock.js";
import { randomToken, sha256Hex } from "./ids.js";

export type Tier = "read" | "propose" | "execute";
const TIER_RANK: Record<Tier, number> = { read: 0, propose: 1, execute: 2 };
export const tierAllows = (granted: Tier, needed: Tier): boolean => TIER_RANK[granted] >= TIER_RANK[needed];

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, saltB64, keyB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const actual = scryptSync(password, Buffer.from(saltB64, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

export interface SessionUser {
  userId: string;
  email: string;
  displayName: string;
  maxTier: Tier;
  csrfToken: string;
}

export const SESSION_TTL_MS = 8 * 3600_000;

export function login(db: Db, clock: Clock, email: string, password: string): { token: string; user: SessionUser } | null {
  const row = db.prepare("SELECT id, email, display_name, password_hash, max_tier FROM users WHERE email = ?").get(email.toLowerCase()) as
    | { id: string; email: string; display_name: string; password_hash: string; max_tier: Tier }
    | undefined;
  // Always burn a hash comparison to keep timing similar for unknown users.
  const ok = verifyPassword(password, row?.password_hash ?? "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(86));
  if (!row || !ok) return null;
  const token = randomToken();
  const csrf = randomToken();
  const now = clock.now();
  db.prepare("INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at) VALUES (?,?,?,?,?)").run(
    sha256Hex(token), row.id, csrf, now.toISOString(), new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
  );
  return { token, user: { userId: row.id, email: row.email, displayName: row.display_name, maxTier: row.max_tier, csrfToken: csrf } };
}

export function sessionUser(db: Db, clock: Clock, token: string | undefined): SessionUser | null {
  if (!token) return null;
  const row = db.prepare(
    `SELECT s.csrf_token, s.expires_at, u.id, u.email, u.display_name, u.max_tier
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
  ).get(sha256Hex(token)) as
    | { csrf_token: string; expires_at: string; id: string; email: string; display_name: string; max_tier: Tier }
    | undefined;
  if (!row || Date.parse(row.expires_at) <= clock.now().getTime()) return null;
  return { userId: row.id, email: row.email, displayName: row.display_name, maxTier: row.max_tier, csrfToken: row.csrf_token };
}

export function logout(db: Db, token: string | undefined): void {
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256Hex(token));
}
