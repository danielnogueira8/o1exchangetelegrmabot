import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { normalizeTokenAddress } from "./alert-identity.js";

export class AlertStore {
  /** @type {Database.Database} */
  #database;

  /** @type {Database.Statement<[number, string]>} */
  #insertClaim;

  /** @type {Database.Statement<[number, string]>} */
  #deleteClaim;

  /** @param {string} filename */
  constructor(filename) {
    if (filename !== ":memory:") {
      mkdirSync(dirname(resolve(filename)), { recursive: true });
    }

    this.#database = new Database(filename);
    this.#database.pragma("busy_timeout = 5000");
    const hasLegacyAlertTable =
      this.#database
        .prepare(`
          SELECT 1
          FROM sqlite_master
          WHERE type = 'table' AND name = 'alerted_tokens'
        `)
        .get() !== undefined;
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS claimed_alerts (
        chain_id INTEGER NOT NULL,
        token_address TEXT NOT NULL,
        claimed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (chain_id, token_address)
      )
    `);
    if (hasLegacyAlertTable) {
      this.#database.exec(`
        INSERT OR IGNORE INTO claimed_alerts (chain_id, token_address, claimed_at)
        SELECT chain_id, token_address, alerted_at
        FROM alerted_tokens
      `);
    }

    this.#insertClaim = this.#database.prepare(`
      INSERT OR IGNORE INTO claimed_alerts (chain_id, token_address)
      VALUES (?, ?)
    `);
    this.#deleteClaim = this.#database.prepare(`
      DELETE FROM claimed_alerts
      WHERE chain_id = ? AND token_address = ?
    `);
  }

  /**
   * @param {number} chainId
   * @param {string} tokenAddress
   */
  claimAlert(chainId, tokenAddress) {
    return this.#insertClaim.run(chainId, normalizeTokenAddress(tokenAddress)).changes === 1;
  }

  /**
   * @param {number} chainId
   * @param {string} tokenAddress
   */
  releaseAlert(chainId, tokenAddress) {
    this.#deleteClaim.run(chainId, normalizeTokenAddress(tokenAddress));
  }

  close() {
    this.#database.close();
  }
}
