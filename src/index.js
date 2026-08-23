import "dotenv/config";

import { loadConfig } from "./config.js";
import { B20Client } from "./b20-client.js";
import { runAllPolls } from "./all-polls.js";
import { NeonAlertStore } from "./neon-alert-store.js";
import { NeonDatabase } from "./neon-database.js";
import { createNotifier } from "./notifier-factory.js";
import { O1Client } from "./o1-client.js";
import { calculateNextPollDelay } from "./poll.js";

const config = loadConfig();
const database = new NeonDatabase(config.databaseUrl);
const alertStore = new NeonAlertStore(database);
const o1Client = new O1Client({
  apiKey: config.o1ApiKey,
  market: config.market,
});
const b20Client = new B20Client();
const notifier = createNotifier(config);

let stopping = false;
/** @type {(() => void) | undefined} */
let interruptWait;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    console.info(`Received ${signal}; stopping after the current poll.`);
    stopping = true;
    interruptWait?.();
  });
}

console.info("Starting o1 token monitor", {
  chains: config.chainIds,
  pollIntervalSeconds: config.pollIntervalMs / 1_000,
  dryRun: config.dryRun,
});

do {
  const pollStartedAt = Date.now();
  const summary = await runAllPolls({
    chainIds: config.chainIds,
    rules: config.rules,
    o1Client,
    b20Client,
    notifier,
    alertStore,
    logger: console,
  });
  console.info("Poll complete", summary);

  if (!config.runOnce && !stopping) {
    await wait(calculateNextPollDelay(pollStartedAt, Date.now(), config.pollIntervalMs));
  }
} while (!config.runOnce && !stopping);

/** @param {number} milliseconds */
function wait(milliseconds) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      interruptWait = undefined;
      resolve(undefined);
    }, milliseconds);
    interruptWait = () => {
      clearTimeout(timer);
      interruptWait = undefined;
      resolve(undefined);
    };
  });
}
