// Resets the SANDBOX test dataset (never the live database).  npm run reset-demo
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { systemClock } from "./clock.js";
import { resetDemo } from "./services/seed.js";

const config = loadConfig({ ...process.env, APP_MODE: "sandbox" });
const db = openDb(config.dbPath, "sandbox");
resetDemo({ db, clock: systemClock, config });
console.log(`SANDBOX test dataset reset at ${config.dbPath}. Test users: alice@demo.local / bob@demo.local (fictional data).`);
