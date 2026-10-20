import type { Db } from "./db.js";
import type { Clock } from "./clock.js";
import type { AppConfig } from "./config.js";

export interface Ctx {
  db: Db;
  clock: Clock;
  config: AppConfig;
  /** Outbound HTTP, injectable so tests never touch the network. Defaults to global fetch. */
  http?: { fetch: typeof fetch };
}

export const httpFetch = (ctx: Ctx): typeof fetch => ctx.http?.fetch ?? fetch;
