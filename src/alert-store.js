import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export class AlertStore {
  /** @type {Database.Database} */
  #database;

  /** @type {Database.Statement<[number, string]>} */
  #findAlert;

  /** @type {Database.Statement<[number, string]>} */
  #insertAlert;

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

    this.#findAlert = this.#database.prepare(`
      SELECT 1
      FROM alerted_tokens
      WHERE chain_id = ? AND token_address = ?
    `);
    this.#insertAlert = this.#database.prepare(`
      INSERT OR IGNORE INTO alerted_tokens (chain_id, token_address)
      VALUES (?, ?)
    `);
  }

  /**
   * @param {number} chainId
   * @param {string} tokenAddress
   */
  hasAlert(chainId, tokenAddress) {
    return this.#findAlert.get(chainId, normalizeAddress(tokenAddress)) !== undefined;
  }

  /**
   * @param {number} chainId
   * @param {string} tokenAddress
   */
  recordAlert(chainId, tokenAddress) {
    this.#insertAlert.run(chainId, normalizeAddress(tokenAddress));
  }

  close() {
    this.#database.close();
  }
}

/** @param {string} address */
function normalizeAddress(address) {
  return address.trim().toLowerCase();
}
