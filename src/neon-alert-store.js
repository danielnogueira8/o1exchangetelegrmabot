import { normalizeTokenAddress } from "./alert-identity.js";

/** @typedef {import("./neon-database.js").NeonDatabaseClient} NeonDatabaseClient */

const CLAIM_ALERT = `INSERT INTO claimed_alerts (chain_id, token_address)
  VALUES ($1, $2)
  ON CONFLICT DO NOTHING
  RETURNING chain_id`;

const RELEASE_ALERT = `DELETE FROM claimed_alerts
  WHERE chain_id = $1 AND token_address = $2`;

export class NeonAlertStore {
  /** @type {NeonDatabaseClient} */
  #database;

  /** @param {NeonDatabaseClient} database */
  constructor(database) {
    this.#database = database;
  }

  /**
   * @param {number} chainId
   * @param {string} tokenAddress
   */
  async claimAlert(chainId, tokenAddress) {
    const rows = await this.#database.query(CLAIM_ALERT, [
      chainId,
      normalizeTokenAddress(tokenAddress),
    ]);
    return rows.length === 1;
  }

  /**
   * @param {number} chainId
   * @param {string} tokenAddress
   */
  async releaseAlert(chainId, tokenAddress) {
    await this.#database.query(RELEASE_ALERT, [
      chainId,
      normalizeTokenAddress(tokenAddress),
    ]);
  }
}
