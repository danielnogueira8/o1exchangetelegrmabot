import { loadConfig } from "./config.js";
import { NeonAlertStore } from "./neon-alert-store.js";
import { NeonDatabase } from "./neon-database.js";
import { NeonPollLock } from "./neon-poll-lock.js";
import { createNotifier } from "./notifier-factory.js";
import { O1Client } from "./o1-client.js";
import { runPoll } from "./poll.js";

/** @typedef {import("./neon-database.js").NeonDatabaseClient} NeonDatabaseClient */
/** @typedef {import("./types.js").O1Token} O1Token */
/** @typedef {import("./types.js").O1ClientLike} O1ClientLike */
/** @typedef {import("./types.js").DeliveryResult} DeliveryResult */

/**
 * @param {{
 *   environment?: Record<string, string | undefined>,
 *   database?: NeonDatabaseClient,
 *   o1Client?: O1ClientLike,
 *   notifier?: { sendTokenAlert(token: O1Token, now?: Date): Promise<DeliveryResult> },
 *   now?: () => Date,
 *   logger?: { info(...values: unknown[]): void, error(...values: unknown[]): void }
 * }} options
 */
export function createCronHandler({
  environment = process.env,
  database,
  o1Client,
  notifier,
  now = () => new Date(),
  logger = console,
}) {
  /** @param {Request} request */
  return async function GET(request) {
    const cronSecret = environment.CRON_SECRET?.trim();
    if (
      cronSecret === undefined ||
      cronSecret === "" ||
      request.headers.get("authorization") !== `Bearer ${cronSecret}`
    ) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    /** @type {NeonPollLock | undefined} */
    let pollLock;
    /** @type {string | null} */
    let lockOwner = null;

    try {
      const config = loadConfig(environment);
      const activeDatabase = database ?? new NeonDatabase(config.databaseUrl);
      const alertStore = new NeonAlertStore(activeDatabase);
      pollLock = new NeonPollLock(activeDatabase);
      lockOwner = await pollLock.tryAcquire();
      if (lockOwner === null) {
        logger.info("Skipping overlapping Vercel cron invocation");
        return Response.json({ ok: true, skipped: true, reason: "already-running" });
      }

      const activeO1Client =
        o1Client ?? new O1Client({ apiKey: config.o1ApiKey, market: config.market });
      const activeNotifier = notifier ?? createNotifier(config, logger);
      const summary = await runPoll({
        chainIds: config.chainIds,
        rules: config.rules,
        now: now(),
        o1Client: activeO1Client,
        notifier: activeNotifier,
        alertStore,
        logger,
      });

      logger.info("Vercel cron poll complete", summary);
      return Response.json({ ok: true, summary });
    } catch (error) {
      logger.error("Vercel cron poll failed", { error });
      return Response.json({ ok: false, error: "poll-failed" }, { status: 500 });
    } finally {
      if (pollLock !== undefined && lockOwner !== null) {
        try {
          await pollLock.release(lockOwner);
        } catch (error) {
          logger.error("Failed to release Vercel poll lock", { error });
        }
      }
    }
  };
}
