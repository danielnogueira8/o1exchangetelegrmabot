import { matchesAlertRules } from "./token-rules.js";
import { NotificationRejectedError } from "./notification-error.js";

/** @typedef {import("./types.js").O1Token} O1Token */
/** @typedef {import("./types.js").O1ClientLike} O1ClientLike */
/** @typedef {import("./types.js").AlertRules} AlertRules */
/** @typedef {import("./types.js").DeliveryResult} DeliveryResult */

const OPTIONAL_DETAILS_TIMEOUT_MS = 1_500;

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
 *   o1Client: O1ClientLike,
 *   notifier: { sendTokenAlert(token: O1Token, now?: Date): Promise<DeliveryResult> },
 *   alertStore: {
 *     claimAlert(chainId: number, tokenAddress: string): boolean | Promise<boolean>,
 *     releaseAlert(chainId: number, tokenAddress: string): void | Promise<void>
 *   },
 *   qualityWatchStore?: { watchToken(token: O1Token, now: Date): Promise<void> },
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
  qualityWatchStore,
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

    /** @type {O1Token[]} */
    const claimedTokens = [];
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

      claimedTokens.push(token);
    }

    const alerts = await Promise.all(
      claimedTokens.map(async (token) => ({
        token,
        alertToken: await withOptionalTokenDetails(token, o1Client, summary, logger),
      })),
    );

    for (const { token, alertToken } of alerts) {
      /** @type {DeliveryResult} */
      let deliveryResult;
      try {
        deliveryResult = await notifier.sendTokenAlert(alertToken, now);
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
      if (qualityWatchStore !== undefined) {
        try {
          await qualityWatchStore.watchToken(alertToken, now);
        } catch (error) {
          summary.errors += 1;
          logger.error("Failed to schedule one-hour token quality watch", {
            chainId: token.chain_id,
            tokenAddress: token.token.address,
            error,
          });
        }
      }
    }
  }

  return summary;
}

/**
 * @param {O1Token} token
 * @param {O1ClientLike} o1Client
 * @param {{ errors: number }} summary
 * @param {{ error(...values: unknown[]): void }} logger
 */
async function withOptionalTokenDetails(token, o1Client, summary, logger) {
  if (o1Client.getTokenDetails === undefined) {
    return token;
  }
  const getTokenDetails = o1Client.getTokenDetails.bind(o1Client);
  try {
    const details = await withOptionalDetailsDeadline(
      (signal) => getTokenDetails(token.chain_id, token.token.address, { signal }),
      OPTIONAL_DETAILS_TIMEOUT_MS,
    );
    return withTokenDetails(token, details);
  } catch (error) {
    summary.errors += 1;
    logger.error("Failed to fetch optional token details", {
      chainId: token.chain_id,
      tokenAddress: token.token.address,
      error,
    });
    return token;
  }
}

/**
 * @template T
 * @param {(signal: AbortSignal) => Promise<T>} operation
 * @param {number} timeoutMs
 * @returns {Promise<T>}
 */
async function withOptionalDetailsDeadline(operation, timeoutMs) {
  const abortController = new AbortController();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timeout;
  const timeoutError = new Error(
    `Optional token details request timed out after ${timeoutMs}ms`,
  );
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      abortController.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(abortController.signal), deadline]);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * @param {O1Token} token
 * @param {O1Token} details
 */
function withTokenDetails(token, details) {
  return {
    ...token,
    token: {
      ...token.token,
      description: details.token.description,
      website: details.token.website,
      x: details.token.x,
      telegram: details.token.telegram,
    },
  };
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
