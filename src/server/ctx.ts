import type { Db } from "./db.js";
import type { Clock } from "./clock.js";
import type { AppConfig } from "./config.js";

export interface Ctx {
  db: Db;
  clock: Clock;
  config: AppConfig;
}
