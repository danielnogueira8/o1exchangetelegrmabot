import "dotenv/config";

import { AlertStore } from "./alert-store.js";
import { loadConfig } from "./config.js";
import { createNotifier } from "./notifier-factory.js";
import { O1Client } from "./o1-client.js";
import { calculateNextPollDelay, runPoll } from "./poll.js";

const config = loadConfig();
const alertStore = new AlertStore(config.sqlitePath);
const o1Client = new O1Client({
  apiKey: config.o1ApiKey,
  market: config.market,
});
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

try {
  console.info("Starting o1 token monitor", {
    chains: config.chainIds,
    pollIntervalSeconds: config.pollIntervalMs / 1_000,
    dryRun: config.dryRun,
  });

  do {
    const pollStartedAt = Date.now();
    const summary = await runPoll({
      chainIds: config.chainIds,
      rules: config.rules,
      o1Client,
      notifier,
      alertStore,
      logger: console,
    });
    console.info("Poll complete", summary);

    if (!config.runOnce && !stopping) {
      await wait(calculateNextPollDelay(pollStartedAt, Date.now(), config.pollIntervalMs));
    }
  } while (!config.runOnce && !stopping);
} finally {
  alertStore.close();
}

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
