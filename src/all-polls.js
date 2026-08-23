import { runPoll } from "./poll.js";
import { addPollSummaries } from "./poll-summary.js";

/**
 * @param {{
 *   chainIds: number[],
 *   rules: import("./types.js").AlertRules,
 *   now?: Date,
 *   o1Client: import("./types.js").O1ClientLike,
 *   b20Client: import("./types.js").O1ClientLike,
 *   notifier: { sendTokenAlert(token: import("./types.js").O1Token, now?: Date): Promise<import("./types.js").DeliveryResult> },
 *   alertStore: {
 *     claimAlert(chainId: number, tokenAddress: string): boolean | Promise<boolean>,
 *     releaseAlert(chainId: number, tokenAddress: string): void | Promise<void>
 *   },
 *   logger: { info(...values: unknown[]): void, error(...values: unknown[]): void }
 * }} dependencies
 */
export async function runAllPolls({
  chainIds,
  rules,
  now,
  o1Client,
  b20Client,
  notifier,
  alertStore,
  logger,
}) {
  const o1Summary = await runPoll({
    chainIds,
    rules,
    now,
    o1Client,
    notifier,
    alertStore,
    logger,
  });
  const b20Summary = await runPoll({
    chainIds: [8453],
    rules,
    now,
    o1Client: b20Client,
    notifier,
    alertStore,
    logger,
  });
  return addPollSummaries(o1Summary, b20Summary);
}
