import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { normalizeTokenAddress } from "./alert-identity.js";

export class AlertStore {
  /** @type {Database.Database} */
  #database;

  /** @type {Database.Statement<[number, string]>} */
  #insertAlert;

  /** @type {Database.Statement<[number, string]>} */
  #deleteAlert;

  /** @param {string} filename */
  constructor(filename) {
    if (filename !== ":memory:") {
      mkdirSync(dirname(resolve(filename)), { recursive: true });
    }

    this.#database = new Database(filename);
    this.#database.pragma("busy_timeout = 5000");
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS alerted_tokens (
        chain_id INTEGER NOT NULL,
        token_address TEXT NOT NULL,
        alerted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (chain_id, token_address)
      )
    `);

    this.#insertAlert = this.#database.prepare(`
      INSERT OR IGNORE INTO alerted_tokens (chain_id, token_address)
      VALUES (?, ?)
    `);
    this.#deleteAlert = this.#database.prepare(`
      DELETE FROM alerted_tokens
      WHERE chain_id = ? AND token_address = ?
    `);
  }

  /**
   * @param {number} chainId
   * @param {string} tokenAddress
   */
  claimAlert(chainId, tokenAddress) {
    return this.#insertAlert.run(chainId, normalizeTokenAddress(tokenAddress)).changes === 1;
  }

  /**
   * @param {number} chainId
   * @param {string} tokenAddress
   */
  releaseAlert(chainId, tokenAddress) {
    this.#deleteAlert.run(chainId, normalizeTokenAddress(tokenAddress));
  }

  close() {
    this.#database.close();
  }
}
