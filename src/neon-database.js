import { neon } from "@neondatabase/serverless";

/**
 * @typedef {{
 *   query(statement: string, parameters?: unknown[]): Promise<Record<string, unknown>[]>
 * }} NeonDatabaseClient
 */

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS claimed_alerts (
    chain_id INTEGER NOT NULL,
    token_address TEXT NOT NULL,
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (chain_id, token_address)
  )`,
  `CREATE TABLE IF NOT EXISTS poll_locks (
    lock_name TEXT PRIMARY KEY,
    owner_token TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS token_quality_watches (
    chain_id INTEGER NOT NULL,
    token_address TEXT NOT NULL,
    token_payload JSONB NOT NULL,
    check_after TIMESTAMPTZ NOT NULL,
    reviewed_at TIMESTAMPTZ,
    confirmation_claimed_at TIMESTAMPTZ,
    PRIMARY KEY (chain_id, token_address)
  )`,
  `DELETE FROM token_quality_watches
    WHERE reviewed_at IS NOT NULL`,
  `ALTER TABLE token_quality_watches
    ADD COLUMN IF NOT EXISTS confirmation_claimed_at TIMESTAMPTZ`,
  `CREATE INDEX IF NOT EXISTS token_quality_watches_due_idx
    ON token_quality_watches (check_after)`,
];
const MAXIMUM_SCHEMA_INITIALIZATION_ATTEMPTS = 3;
const SCHEMA_RETRY_DELAY_MS = 50;

export class NeonDatabase {
  /** @type {NeonDatabaseClient} */
  #sql;

  /** @type {Promise<void> | undefined} */
  #schemaReady;

  /**
   * @param {string} databaseUrl
   * @param {{ sql?: NeonDatabaseClient }} [options]
   */
  constructor(databaseUrl, { sql = neon(databaseUrl) } = {}) {
    this.#sql = sql;
  }

  /**
   * @param {string} statement
   * @param {unknown[]} [parameters]
   */
  async query(statement, parameters = []) {
    await this.#initializeSchema();
    return this.#sql.query(statement, parameters);
  }

  async #initializeSchema() {
    if (this.#schemaReady === undefined) {
      this.#schemaReady = this.#createSchema();
    }

    try {
      await this.#schemaReady;
    } catch (error) {
      this.#schemaReady = undefined;
      throw error;
    }
  }

  async #createSchema() {
    for (let attempt = 1; attempt <= MAXIMUM_SCHEMA_INITIALIZATION_ATTEMPTS; attempt += 1) {
      try {
        for (const statement of SCHEMA_STATEMENTS) {
          await this.#sql.query(statement);
        }
        return;
      } catch (error) {
        if (
          attempt === MAXIMUM_SCHEMA_INITIALIZATION_ATTEMPTS ||
          !isConcurrentSchemaInitializationError(error)
        ) {
          throw error;
        }
        await waitForSchemaRetry(attempt);
      }
    }
  }
}

/** @param {unknown} error */
function isConcurrentSchemaInitializationError(error) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "23505" || error.code === "42P07")
  );
}

/** @param {number} attempt */
function waitForSchemaRetry(attempt) {
  return new Promise((resolve) => {
    setTimeout(resolve, attempt * SCHEMA_RETRY_DELAY_MS);
  });
}
