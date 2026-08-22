import { randomUUID } from "node:crypto";

import { VERCEL_POLL_LOCK_TTL_SECONDS } from "./vercel-policy.js";

/** @typedef {import("./redis-client.js").RedisClient} RedisClient */

const POLL_LOCK_KEY = "o1:poll-lock";
const RELEASE_IF_OWNER_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

export class RedisPollLock {
  /** @type {Pick<RedisClient, "set" | "eval">} */
  #redis;

  /** @type {() => string} */
  #createOwnerToken;

  /**
   * @param {Pick<RedisClient, "set" | "eval">} redis
   * @param {{ createOwnerToken?: () => string }} [options]
   */
  constructor(redis, { createOwnerToken = randomUUID } = {}) {
    this.#redis = redis;
    this.#createOwnerToken = createOwnerToken;
  }

  async tryAcquire() {
    const ownerToken = this.#createOwnerToken();
    const result = await this.#redis.set(POLL_LOCK_KEY, ownerToken, {
      nx: true,
      ex: VERCEL_POLL_LOCK_TTL_SECONDS,
    });
    return result === "OK" ? ownerToken : null;
  }

  /** @param {string} ownerToken */
  async release(ownerToken) {
    const result = await this.#redis.eval(
      RELEASE_IF_OWNER_SCRIPT,
      [POLL_LOCK_KEY],
      [ownerToken],
    );
    return result === 1;
  }
}
