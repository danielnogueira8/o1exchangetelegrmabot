import { runPoll } from "./poll.js";
import { addPollSummaries } from "./poll-summary.js";
import { runOneHourQualityChecks } from "./quality-checks.js";
import { UNKNOWN_LAUNCH_SOURCE } from "./launch-sources.js";

/**
 * @param {{
 *   chainIds: number[],
 *   rules: import("./types.js").AlertRules,
 *   now?: Date,
 *   o1Client: import("./types.js").O1ClientLike,
 *   b20Client: import("./types.js").O1ClientLike,
 *   notifier: {
 *     sendTokenAlert(token: import("./types.js").O1Token, now?: Date): Promise<import("./types.js").DeliveryResult>,
 *     sendQualityConfirmation?(token: import("./types.js").O1Token, orders: import("./types.js").PaidDexScreenerOrder[], quality: import("./types.js").OneHourQuality, now?: Date): Promise<unknown>
 *   },
 *   alertStore: {
 *     claimAlert(chainId: number, tokenAddress: string): boolean | Promise<boolean>,
 *     releaseAlert(chainId: number, tokenAddress: string): void | Promise<void>
 *   },
 *   qualityWatchStore?: {
 *     watchToken(token: import("./types.js").O1Token, now: Date): Promise<void>,
 *     listDueWatches(now: Date): Promise<import("./types.js").O1Token[]>,
 *     removeWatch(token: import("./types.js").O1Token): Promise<void>,
 *     claimConfirmation(token: import("./types.js").O1Token): Promise<boolean>,
 *     releaseConfirmationClaim(token: import("./types.js").O1Token): Promise<void>
 *   },
 *   dexScreenerClient?: {
 *     listActivePaidOrders(chainId: number, tokenAddress: string): Promise<import("./types.js").PaidDexScreenerOrder[]>,
 *     getOneHourQuality(chainId: number, tokenAddress: string): Promise<import("./types.js").OneHourQuality | undefined>
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
  qualityWatchStore,
  dexScreenerClient,
  logger,
}) {
  const pollNow = now ?? new Date();
  const launchSources = await listLaunchSources(b20Client, logger);
  const o1Summary = await runPoll({
    chainIds,
    rules,
    now: pollNow,
    o1Client: withLaunchSources(o1Client, launchSources),
    notifier,
    alertStore,
    qualityWatchStore,
    logger,
  });
  const b20Summary = await runPoll({
    chainIds: [8453],
    rules,
    now: pollNow,
    o1Client: b20Client,
    notifier,
    alertStore,
    qualityWatchStore,
    logger,
  });
  if (qualityWatchStore !== undefined && dexScreenerClient !== undefined) {
    await runOneHourQualityChecks({
      now: pollNow,
      watchStore: qualityWatchStore,
      dexScreenerClient,
      notifier,
      logger,
    });
  }
  return addPollSummaries(o1Summary, b20Summary);
}

/**
 * @param {import("./types.js").O1ClientLike} b20Client
 * @param {{ error(...values: unknown[]): void }} logger
 * @returns {Promise<Map<string, string> | undefined>}
 */
async function listLaunchSources(b20Client, logger) {
  if (b20Client.listLaunchSources === undefined) {
    return new Map();
  }
  try {
    const sources = await b20Client.listLaunchSources(8453);
    return new Map(
      sources.map((source) => [
        `${source.chain_id}:${source.token_address.toLowerCase()}`,
        source.source,
      ]),
    );
  } catch (error) {
    logger.error("Failed to fetch Base B20 launch sources", { error });
    return undefined;
  }
}

/**
 * @param {import("./types.js").O1ClientLike} o1Client
 * @param {Map<string, string> | undefined} launchSources
 */
function withLaunchSources(o1Client, launchSources) {
  return {
    ...o1Client,
    /** @param {number} chainId */
    async listTokens(chainId) {
      const tokens = await o1Client.listTokens(chainId);
      return tokens.map((token) => {
        const source = launchSources?.get(
          `${token.chain_id}:${token.token.address.toLowerCase()}`,
        );
        if (source !== undefined) {
          return { ...token, launch: { ...token.launch, source } };
        }
        if (launchSources === undefined && token.chain_id === 8453 && !token.launch.source) {
          return {
            ...token,
            launch: { ...token.launch, source: UNKNOWN_LAUNCH_SOURCE },
          };
        }
        return token;
      });
    },
    getTokenDetails: o1Client.getTokenDetails?.bind(o1Client),
  };
}
