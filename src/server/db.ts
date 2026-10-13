import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Db = Database.Database;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  max_tier TEXT NOT NULL CHECK (max_tier IN ('read','propose','execute')),
  scenario TEXT NOT NULL DEFAULT 'standard'
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger_accounts (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('user','university','settlement')),
  currency TEXT NOT NULL CHECK (currency IN ('USD','KZT')),
  balance_minor TEXT NOT NULL CHECK (balance_minor GLOB '[0-9]*' OR balance_minor GLOB '-[0-9]*'),
  reserve_minor TEXT NOT NULL DEFAULT '0'
);
CREATE INDEX IF NOT EXISTS ix_ledger_accounts_owner ON ledger_accounts(owner_user_id, currency);
CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES ledger_accounts(id),
  currency TEXT NOT NULL,
  delta_minor TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS trusted_recipients (
  registry_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  account TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  reference TEXT NOT NULL,
  recipient_registry_id TEXT NOT NULL,
  beneficiary_name TEXT NOT NULL,
  beneficiary_account TEXT NOT NULL,
  amount_kzt_tiyn TEXT NOT NULL,
  due_at TEXT NOT NULL,
  source_type TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  ambiguous_fields TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('DRAFT','BLOCKED','CONFIRMED','PAID')),
  issues_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  UNIQUE (owner_user_id, reference)
);
CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  provider_id TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  version INTEGER NOT NULL,
  src_ccy TEXT NOT NULL,
  dst_ccy TEXT NOT NULL,
  rate TEXT NOT NULL,
  fee_cents TEXT NOT NULL,
  min_kzt_tiyn TEXT NOT NULL,
  max_kzt_tiyn TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  est_arrival_at TEXT NOT NULL,
  eligible INTEGER NOT NULL,
  ineligible_reason TEXT,
  provenance TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  quote_id TEXT NOT NULL REFERENCES quotes(id),
  task_id TEXT,
  hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  display_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','EXECUTED','SUPERSEDED','REJECTED')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS proposals_immutable
BEFORE UPDATE OF owner_user_id, invoice_id, quote_id, hash, payload_json, display_json, created_at, expires_at ON proposals
BEGIN SELECT RAISE(ABORT, 'proposal fields are immutable'); END;
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL UNIQUE REFERENCES proposals(id),
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  proposal_hash TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE TABLE IF NOT EXISTS agent_tasks (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  instruction TEXT NOT NULL,
  intent_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('RUNNING','AWAITING_APPROVAL','EXECUTING','COMPLETED','BLOCKED','FAILED','CANCELLED')),
  mode TEXT NOT NULL CHECK (mode IN ('LIVE','MOCK')),
  model TEXT,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  model_requests INTEGER NOT NULL DEFAULT 0,
  retries INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  usage_known INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  proposal_id TEXT,
  payment_id TEXT,
  summary TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES agent_tasks(id),
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  tool TEXT,
  ok INTEGER,
  input_json TEXT,
  output_json TEXT,
  text TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  proposal_id TEXT NOT NULL UNIQUE REFERENCES proposals(id),
  invoice_id TEXT NOT NULL UNIQUE REFERENCES invoices(id),
  approval_id TEXT NOT NULL UNIQUE REFERENCES approvals(id),
  receipt_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  owner_user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  payment_id TEXT NOT NULL REFERENCES payments(id),
  PRIMARY KEY (owner_user_id, key)
);
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  owner_user_id TEXT,
  task_id TEXT,
  mode TEXT,
  event TEXT NOT NULL,
  result TEXT NOT NULL,
  refs_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS ix_audit_owner ON audit_events(owner_user_id, ts);
`;

export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  if (path !== ":memory:") db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

export const DYNAMIC_TABLES = [
  "audit_events", "idempotency_keys", "payments", "agent_events", "agent_tasks", "approvals",
  "proposals", "quotes", "invoices", "ledger_entries", "ledger_accounts", "sessions", "trusted_recipients", "users",
];
