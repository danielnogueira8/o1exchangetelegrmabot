/** @typedef {import("./types.js").O1Token} O1Token */
/** @typedef {import("./types.js").OneHourQuality} OneHourQuality */
/** @typedef {import("./types.js").PaidDexScreenerOrder} PaidDexScreenerOrder */

import { NotificationRejectedError } from "./notification-error.js";

/**
 * @param {{
 *   now: Date,
 *   watchStore: {
 *     listDueWatches(now: Date): Promise<O1Token[]>,
 *     removeWatch(token: O1Token): Promise<void>,
 *     claimConfirmation(token: O1Token): Promise<boolean>,
 *     releaseConfirmationClaim(token: O1Token): Promise<void>
 *   },
 *   dexScreenerClient: {
 *     listActivePaidOrders(chainId: number, tokenAddress: string): Promise<PaidDexScreenerOrder[]>,
 *     getOneHourQuality(chainId: number, tokenAddress: string): Promise<OneHourQuality | undefined>
 *   },
 *   notifier: {
 *     sendTokenAlert(token: O1Token, now?: Date): Promise<unknown>,
 *     sendQualityConfirmation?(token: O1Token, orders: PaidDexScreenerOrder[], quality: OneHourQuality, now?: Date): Promise<unknown>
 *   },
 *   logger: { error(...values: unknown[]): void }
 * }} dependencies
 */
export async function runOneHourQualityChecks({
  now,
  watchStore,
  dexScreenerClient,
  notifier,
  logger,
}) {
  let watches;
  try {
    watches = await watchStore.listDueWatches(now);
  } catch (error) {
    logger.error("Failed to load one-hour token quality watches", { error });
    return;
  }

  for (const token of watches) {
    let orders;
    let quality;
    try {
      [orders, quality] = await Promise.all([
        dexScreenerClient.listActivePaidOrders(token.chain_id, token.token.address),
        dexScreenerClient.getOneHourQuality(token.chain_id, token.token.address),
      ]);
    } catch (error) {
      logger.error("Failed to check one-hour DexScreener quality", {
        chainId: token.chain_id,
        tokenAddress: token.token.address,
        error,
      });
      continue;
    }

    if (orders.length === 0 || quality === undefined) {
      await removeWatch(watchStore, token, logger);
      continue;
    }
    if (notifier.sendQualityConfirmation === undefined) {
      logger.error("One-hour token quality confirmation is not configured", {
        chainId: token.chain_id,
        tokenAddress: token.token.address,
      });
      continue;
    }
    let confirmationClaimed;
    try {
      confirmationClaimed = await watchStore.claimConfirmation(token);
    } catch (error) {
      logger.error("Failed to claim one-hour token quality confirmation", {
        chainId: token.chain_id,
        tokenAddress: token.token.address,
        error,
      });
      continue;
    }
    if (!confirmationClaimed) {
      continue;
    }
    try {
      await notifier.sendQualityConfirmation(token, orders, quality, now);
    } catch (error) {
      logger.error("Failed to deliver one-hour token quality confirmation", {
        chainId: token.chain_id,
        tokenAddress: token.token.address,
        error,
      });
      if (error instanceof NotificationRejectedError) {
        await releaseConfirmationClaim(watchStore, token, logger);
      }
      continue;
    }
    await removeWatch(watchStore, token, logger);
  }
}

/**
 * @param {{ releaseConfirmationClaim(token: O1Token): Promise<void> }} watchStore
 * @param {O1Token} token
 * @param {{ error(...values: unknown[]): void }} logger
 */
async function releaseConfirmationClaim(watchStore, token, logger) {
  try {
    await watchStore.releaseConfirmationClaim(token);
  } catch (error) {
    logger.error("Failed to release one-hour token quality confirmation claim", {
      chainId: token.chain_id,
      tokenAddress: token.token.address,
      error,
    });
  }
}

/**
 * @param {{ removeWatch(token: O1Token): Promise<void> }} watchStore
 * @param {O1Token} token
 * @param {{ error(...values: unknown[]): void }} logger
 */
async function removeWatch(watchStore, token, logger) {
  try {
    await watchStore.removeWatch(token);
  } catch (error) {
    logger.error("Failed to remove one-hour token quality watch", {
      chainId: token.chain_id,
      tokenAddress: token.token.address,
      error,
    });
  }
}
