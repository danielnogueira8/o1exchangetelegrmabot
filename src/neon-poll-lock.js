import { randomUUID } from "node:crypto";

import { VERCEL_POLL_LOCK_TTL_SECONDS } from "./vercel-policy.js";

/** @typedef {import("./neon-database.js").NeonDatabaseClient} NeonDatabaseClient */

const POLL_LOCK_NAME = "o1:poll-lock";
const CLAIM_LOCK = `INSERT INTO poll_locks (lock_name, owner_token, expires_at)
  VALUES ($1, $2, NOW() + $3::INTEGER * INTERVAL '1 second')
  ON CONFLICT (lock_name) DO UPDATE
  SET owner_token = EXCLUDED.owner_token,
      expires_at = EXCLUDED.expires_at
  WHERE poll_locks.expires_at <= NOW()
  RETURNING lock_name`;
const RELEASE_LOCK = `DELETE FROM poll_locks
  WHERE lock_name = $1 AND owner_token = $2
  RETURNING lock_name`;

export class NeonPollLock {
  /** @type {NeonDatabaseClient} */
  #database;

  /** @type {() => string} */
  #createOwnerToken;

  /**
   * @param {NeonDatabaseClient} database
   * @param {{ createOwnerToken?: () => string }} [options]
   */
  constructor(database, { createOwnerToken = randomUUID } = {}) {
    this.#database = database;
    this.#createOwnerToken = createOwnerToken;
  }

  async tryAcquire() {
    const ownerToken = this.#createOwnerToken();
    const rows = await this.#database.query(CLAIM_LOCK, [
      POLL_LOCK_NAME,
      ownerToken,
      VERCEL_POLL_LOCK_TTL_SECONDS,
    ]);
    return rows.length === 1 ? ownerToken : null;
  }

  /** @param {string} ownerToken */
  async release(ownerToken) {
    const rows = await this.#database.query(RELEASE_LOCK, [POLL_LOCK_NAME, ownerToken]);
    return rows.length === 1;
  }
}
