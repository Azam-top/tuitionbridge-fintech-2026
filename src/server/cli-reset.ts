import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { systemClock } from "./clock.js";
import { resetDemo } from "./services/seed.js";

const config = loadConfig();
if (!config.demoMode) {
  console.error("Refusing to reset: APP_DEMO_MODE=0.");
  process.exit(1);
}
const db = openDb(config.dbPath);
resetDemo({ db, clock: systemClock, config });
console.log(`Demo dataset reset at ${config.dbPath}. Users: alice@demo.local / bob@demo.local (see README).`);
