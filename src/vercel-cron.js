import { RedisAlertStore } from "./redis-alert-store.js";
import { loadConfig } from "./config.js";
import { createNotifier } from "./notifier-factory.js";
import { O1Client } from "./o1-client.js";
import { runPoll } from "./poll.js";
import { RedisPollLock } from "./redis-poll-lock.js";

/** @typedef {import("./redis-client.js").RedisClient} RedisClient */
/** @typedef {import("./types.js").O1Token} O1Token */
/** @typedef {import("./types.js").DeliveryResult} DeliveryResult */

/**
 * @param {{
 *   environment?: Record<string, string | undefined>,
 *   createRedis: () => RedisClient,
 *   o1Client?: { listTokens(chainId: number): Promise<O1Token[]> },
 *   notifier?: { sendTokenAlert(token: O1Token, now?: Date): Promise<DeliveryResult> },
 *   now?: () => Date,
 *   logger?: { info(...values: unknown[]): void, error(...values: unknown[]): void }
 * }} options
 */
export function createCronHandler({
  environment = process.env,
  createRedis,
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

    /** @type {RedisPollLock | undefined} */
    let pollLock;
    /** @type {string | null} */
    let lockOwner = null;

    try {
      const redis = createRedis();
      const alertStore = new RedisAlertStore(redis);
      pollLock = new RedisPollLock(redis);
      lockOwner = await pollLock.tryAcquire();
      if (lockOwner === null) {
        logger.info("Skipping overlapping Vercel cron invocation");
        return Response.json({ ok: true, skipped: true, reason: "already-running" });
      }

      const config = loadConfig(environment);
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
