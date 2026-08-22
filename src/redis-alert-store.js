/** @typedef {import("./redis-client.js").RedisClient} RedisClient */

import { normalizeTokenAddress } from "./alert-identity.js";

export class RedisAlertStore {
  /** @type {Pick<RedisClient, "set" | "del">} */
  #redis;

  /** @param {Pick<RedisClient, "set" | "del">} redis */
  constructor(redis) {
    this.#redis = redis;
  }

  /**
   * @param {number} chainId
   * @param {string} tokenAddress
   */
  async claimAlert(chainId, tokenAddress) {
    const result = await this.#redis.set(alertKey(chainId, tokenAddress), "1", { nx: true });
    return result === "OK";
  }

  /**
   * @param {number} chainId
   * @param {string} tokenAddress
   */
  async releaseAlert(chainId, tokenAddress) {
    await this.#redis.del(alertKey(chainId, tokenAddress));
  }
}

/**
 * @param {number} chainId
 * @param {string} tokenAddress
 */
function alertKey(chainId, tokenAddress) {
  return `o1:alerts:${chainId}:${normalizeTokenAddress(tokenAddress)}`;
}
