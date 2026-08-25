import { normalizeTokenAddress } from "./alert-identity.js";

/** @typedef {import("./neon-database.js").NeonDatabaseClient} NeonDatabaseClient */
/** @typedef {import("./types.js").O1Token} O1Token */

const ONE_HOUR_MS = 60 * 60 * 1_000;
const WATCH_TOKEN = `INSERT INTO token_quality_watches
  (chain_id, token_address, token_payload, check_after)
  VALUES ($1, $2, $3::jsonb, $4)
  ON CONFLICT DO NOTHING`;
const LIST_DUE_WATCHES = `SELECT chain_id, token_address, token_payload
  FROM token_quality_watches
  WHERE check_after <= $1 AND reviewed_at IS NULL AND confirmation_claimed_at IS NULL
  ORDER BY check_after
  LIMIT $2`;
const REMOVE_WATCH = `DELETE FROM token_quality_watches
  WHERE chain_id = $1 AND token_address = $2`;
const CLAIM_CONFIRMATION = `UPDATE token_quality_watches
  SET confirmation_claimed_at = CURRENT_TIMESTAMP
  WHERE chain_id = $1 AND token_address = $2 AND confirmation_claimed_at IS NULL
  RETURNING chain_id`;
const RELEASE_CONFIRMATION_CLAIM = `UPDATE token_quality_watches
  SET confirmation_claimed_at = NULL
  WHERE chain_id = $1 AND token_address = $2`;

export class NeonQualityWatchStore {
  /** @type {NeonDatabaseClient} */
  #database;

  /** @param {NeonDatabaseClient} database */
  constructor(database) {
    this.#database = database;
  }

  /** @param {O1Token} token @param {Date} now */
  async watchToken(token, now) {
    await this.#database.query(WATCH_TOKEN, [
      token.chain_id,
      normalizeTokenAddress(token.token.address),
      JSON.stringify(token),
      new Date(now.getTime() + ONE_HOUR_MS).toISOString(),
    ]);
  }

  /** @param {Date} now @param {number} [limit] */
  async listDueWatches(now, limit = 50) {
    const rows = await this.#database.query(LIST_DUE_WATCHES, [now.toISOString(), limit]);
    return rows.flatMap((row) => {
      try {
        const token =
          typeof row.token_payload === "string"
            ? JSON.parse(row.token_payload)
            : row.token_payload;
        return isToken(token) ? [token] : [];
      } catch {
        return [];
      }
    });
  }

  /** @param {O1Token} token */
  async removeWatch(token) {
    await this.#database.query(REMOVE_WATCH, [
      token.chain_id,
      normalizeTokenAddress(token.token.address),
    ]);
  }

  /** @param {O1Token} token */
  async claimConfirmation(token) {
    const rows = await this.#database.query(CLAIM_CONFIRMATION, [
      token.chain_id,
      normalizeTokenAddress(token.token.address),
    ]);
    return rows.length === 1;
  }

  /** @param {O1Token} token */
  async releaseConfirmationClaim(token) {
    await this.#database.query(RELEASE_CONFIRMATION_CLAIM, [
      token.chain_id,
      normalizeTokenAddress(token.token.address),
    ]);
  }
}

/** @param {unknown} value @returns {value is O1Token} */
function isToken(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    "chain_id" in value &&
    typeof value.chain_id === "number" &&
    "token" in value &&
    value.token !== null &&
    typeof value.token === "object" &&
    "address" in value.token &&
    typeof value.token.address === "string"
  );
}
