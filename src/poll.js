import { matchesAlertRules } from "./token-rules.js";
import { NotificationRejectedError } from "./notification-error.js";

/** @typedef {import("./types.js").O1Token} O1Token */
/** @typedef {import("./types.js").AlertRules} AlertRules */
/** @typedef {import("./types.js").DeliveryResult} DeliveryResult */

/**
 * @param {number} pollStartedAt
 * @param {number} pollFinishedAt
 * @param {number} intervalMs
 */
export function calculateNextPollDelay(pollStartedAt, pollFinishedAt, intervalMs) {
  const elapsedMs = Math.max(0, pollFinishedAt - pollStartedAt);
  return Math.max(0, intervalMs - elapsedMs);
}

/**
 * @param {{
 *   chainIds: number[],
 *   rules: AlertRules,
 *   now?: Date,
 *   o1Client: { listTokens(chainId: number): Promise<O1Token[]> },
 *   notifier: { sendTokenAlert(token: O1Token, now?: Date): Promise<DeliveryResult> },
 *   alertStore: {
 *     claimAlert(chainId: number, tokenAddress: string): boolean | Promise<boolean>,
 *     releaseAlert(chainId: number, tokenAddress: string): void | Promise<void>
 *   },
 *   logger: { info(...values: unknown[]): void, error(...values: unknown[]): void }
 * }} dependencies
 */
export async function runPoll({
  chainIds,
  rules,
  now = new Date(),
  o1Client,
  notifier,
  alertStore,
  logger,
}) {
  const summary = {
    fetched: 0,
    qualified: 0,
    sent: 0,
    alreadyClaimed: 0,
    errors: 0,
  };

  for (const chainId of chainIds) {
    /** @type {O1Token[]} */
    let tokens;
    try {
      tokens = await o1Client.listTokens(chainId);
    } catch (error) {
      summary.errors += 1;
      logger.error("Failed to fetch tokens", { chainId, error });
      continue;
    }

    summary.fetched += tokens.length;

    for (const token of tokens) {
      if (!matchesAlertRules(token, rules, now)) {
        continue;
      }

      summary.qualified += 1;

      let claimed;
      try {
        claimed = await alertStore.claimAlert(token.chain_id, token.token.address);
      } catch (error) {
        summary.errors += 1;
        logger.error("Failed to claim token alert", {
          chainId: token.chain_id,
          tokenAddress: token.token.address,
          error,
        });
        continue;
      }

      if (!claimed) {
        summary.alreadyClaimed += 1;
        continue;
      }

      /** @type {DeliveryResult} */
      let deliveryResult;
      try {
        deliveryResult = await notifier.sendTokenAlert(token, now);
      } catch (error) {
        summary.errors += 1;
        logger.error("Failed to deliver token alert", {
          chainId: token.chain_id,
          tokenAddress: token.token.address,
          error,
        });
        if (error instanceof NotificationRejectedError) {
          await releaseClaim(alertStore, token, summary, logger);
        }
        continue;
      }

      if (deliveryResult === "previewed") {
        await releaseClaim(alertStore, token, summary, logger);
        continue;
      }

      summary.sent += 1;
    }
  }

  return summary;
}

/**
 * @param {{ releaseAlert(chainId: number, tokenAddress: string): void | Promise<void> }} alertStore
 * @param {O1Token} token
 * @param {{ errors: number }} summary
 * @param {{ error(...values: unknown[]): void }} logger
 */
async function releaseClaim(alertStore, token, summary, logger) {
  try {
    await alertStore.releaseAlert(token.chain_id, token.token.address);
  } catch (error) {
    summary.errors += 1;
    logger.error("Failed to release token alert claim", {
      chainId: token.chain_id,
      tokenAddress: token.token.address,
      error,
    });
  }
}
