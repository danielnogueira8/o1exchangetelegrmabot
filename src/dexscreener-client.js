const DEX_CHAIN_IDS = new Map([
  [8453, "base"],
  [143, "monad"],
  [4663, "robinhood"],
]);

const ACTIVE_ORDER_STATUSES = new Set(["processing", "on-hold", "approved"]);
const MINIMUM_MARKET_CAP_USD = 50_000;
const MINIMUM_ONE_HOUR_VOLUME_USD = 10_000;
const MINIMUM_LIQUIDITY_USD = 10_000;
const MINIMUM_ONE_HOUR_TRADES = 20;

/** @typedef {import("./types.js").OneHourQuality} OneHourQuality */
/** @typedef {import("./types.js").PaidDexScreenerOrder} PaidDexScreenerOrder */

export class DexScreenerClient {
  /** @type {typeof fetch} */
  #fetch;

  /** @param {{ fetchImpl?: typeof fetch }} [options] */
  constructor({ fetchImpl = fetch } = {}) {
    this.#fetch = fetchImpl;
  }

  /** @param {number} chainId @param {string} tokenAddress */
  async listActivePaidOrders(chainId, tokenAddress) {
    const dexChainId = dexChainIdFor(chainId);
    if (dexChainId === undefined) {
      return [];
    }
    const response = await this.#fetch(
      `https://api.dexscreener.com/orders/v1/${dexChainId}/${encodeURIComponent(tokenAddress)}`,
      { headers: { accept: "application/json" }, signal: AbortSignal.timeout(4_000) },
    );
    if (!response.ok) {
      throw new Error(`DexScreener orders request failed with status ${response.status}`);
    }
    const payload = /** @type {unknown} */ (await response.json());
    if (!Array.isArray(payload)) {
      throw new Error("DexScreener orders response was not an array");
    }
    return payload.filter(isActivePaidOrder);
  }

  /** @param {number} chainId @param {string} tokenAddress */
  async getOneHourQuality(chainId, tokenAddress) {
    const dexChainId = dexChainIdFor(chainId);
    if (dexChainId === undefined) {
      return undefined;
    }
    const response = await this.#fetch(
      `https://api.dexscreener.com/token-pairs/v1/${dexChainId}/${encodeURIComponent(tokenAddress)}`,
      { headers: { accept: "application/json" }, signal: AbortSignal.timeout(4_000) },
    );
    if (!response.ok) {
      throw new Error(`DexScreener token-pairs request failed with status ${response.status}`);
    }
    const payload = /** @type {unknown} */ (await response.json());
    if (!Array.isArray(payload)) {
      throw new Error("DexScreener token-pairs response was not an array");
    }
    return payload
      .map(toOneHourQuality)
      .filter((value) => value !== undefined)
      .filter(isSustainedOneHourQuality)
      .sort((left, right) => right.liquidityUsd - left.liquidityUsd)[0];
  }
}

/** @param {number} chainId */
function dexChainIdFor(chainId) {
  return DEX_CHAIN_IDS.get(chainId);
}

/** @param {unknown} order @returns {order is PaidDexScreenerOrder} */
function isActivePaidOrder(order) {
  return (
    order !== null &&
    typeof order === "object" &&
    "type" in order &&
    typeof order.type === "string" &&
    "status" in order &&
    typeof order.status === "string" &&
    ACTIVE_ORDER_STATUSES.has(order.status) &&
    "paymentTimestamp" in order &&
    typeof order.paymentTimestamp === "number" &&
    Number.isFinite(order.paymentTimestamp)
  );
}

/** @param {OneHourQuality} quality */
function isSustainedOneHourQuality(quality) {
  const hasThresholdMetric =
    (quality.marketCapUsd !== undefined && quality.marketCapUsd >= MINIMUM_MARKET_CAP_USD) ||
    quality.oneHourVolumeUsd >= MINIMUM_ONE_HOUR_VOLUME_USD;
  return (
    hasThresholdMetric &&
    quality.liquidityUsd >= MINIMUM_LIQUIDITY_USD &&
    quality.oneHourTrades >= MINIMUM_ONE_HOUR_TRADES
  );
}

/** @param {unknown} pair @returns {OneHourQuality | undefined} */
function toOneHourQuality(pair) {
  if (pair === null || typeof pair !== "object") {
    return undefined;
  }
  const liquidityUsd = numberAt(pair, ["liquidity", "usd"]);
  const marketCapUsd = numberAt(pair, ["marketCap"]);
  const oneHourVolumeUsd = numberAt(pair, ["volume", "h1"]);
  const buys = numberAt(pair, ["txns", "h1", "buys"]);
  const sells = numberAt(pair, ["txns", "h1", "sells"]);
  if (
    liquidityUsd === undefined ||
    oneHourVolumeUsd === undefined ||
    buys === undefined ||
    sells === undefined
  ) {
    return undefined;
  }
  return {
    liquidityUsd,
    ...(marketCapUsd === undefined ? {} : { marketCapUsd }),
    oneHourVolumeUsd,
    oneHourTrades: buys + sells,
  };
}

/** @param {object} pair @param {string[]} path */
function numberAt(pair, path) {
  /** @type {unknown} */
  let value = pair;
  for (const key of path) {
    if (value === null || typeof value !== "object" || !(key in value)) {
      return undefined;
    }
    value = /** @type {Record<string, unknown>} */ (value)[key];
  }
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
