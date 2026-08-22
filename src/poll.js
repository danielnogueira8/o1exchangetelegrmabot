import { matchesAlertRules } from "./token-rules.js";

/** @typedef {import("./types.js").O1Token} O1Token */
/** @typedef {import("./types.js").AlertRules} AlertRules */

/**
 * @param {{
 *   chainIds: number[],
 *   rules: AlertRules,
 *   now?: Date,
 *   o1Client: { listTokens(chainId: number): Promise<O1Token[]> },
 *   notifier: { sendTokenAlert(token: O1Token, now?: Date): Promise<boolean> },
 *   alertStore: {
 *     hasAlert(chainId: number, tokenAddress: string): boolean,
 *     recordAlert(chainId: number, tokenAddress: string): void
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
    alreadyAlerted: 0,
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

      if (alertStore.hasAlert(token.chain_id, token.token.address)) {
        summary.alreadyAlerted += 1;
        continue;
      }

      let delivered;
      try {
        delivered = await notifier.sendTokenAlert(token, now);
      } catch (error) {
        summary.errors += 1;
        logger.error("Failed to deliver token alert", {
          chainId: token.chain_id,
          tokenAddress: token.token.address,
          error,
        });
        continue;
      }

      if (delivered) {
        alertStore.recordAlert(token.chain_id, token.token.address);
        summary.sent += 1;
      }
    }
  }

  return summary;
}
