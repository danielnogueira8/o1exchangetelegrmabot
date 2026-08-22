export class RedisAlertStore {
  /** @type {RedisClient} */
  #redis;

  /** @param {RedisClient} redis */
  constructor(redis) {
    this.#redis = redis;
  }

  /**
   * @param {number} chainId
   * @param {string} tokenAddress
   */
  async hasAlert(chainId, tokenAddress) {
    return (await this.#redis.exists(alertKey(chainId, tokenAddress))) === 1;
  }

  /**
   * @param {number} chainId
   * @param {string} tokenAddress
   */
  async recordAlert(chainId, tokenAddress) {
    await this.#redis.set(alertKey(chainId, tokenAddress), "1");
  }

  async tryAcquirePollLock() {
    const result = await this.#redis.set("o1:poll-lock", "1", { nx: true, ex: 55 });
    return result === "OK";
  }
}

/**
 * @param {number} chainId
 * @param {string} tokenAddress
 */
function alertKey(chainId, tokenAddress) {
  return `o1:alerts:${chainId}:${tokenAddress.trim().toLowerCase()}`;
}

/**
 * @typedef {{
 *   exists(key: string): Promise<number>,
 *   set(key: string, value: string, options?: { nx?: boolean, ex?: number }): Promise<unknown>
 * }} RedisClient
 */
