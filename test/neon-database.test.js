import assert from "node:assert/strict";
import test from "node:test";

import { NeonDatabase } from "../src/neon-database.js";

test("NeonDatabase initializes the alert and lock tables once", async () => {
  /** @type {{ statement: string, parameters: unknown[] }[]} */
  const queries = [];
  const database = new NeonDatabase("postgresql://example.test/neondb", {
    sql: {
      async query(statement, parameters = []) {
        queries.push({ statement, parameters });
        return [];
      },
    },
  });

  await database.query("SELECT $1", ["first"]);
  await database.query("SELECT $1", ["second"]);

  assert.equal(queries.filter(({ statement }) => statement.startsWith("CREATE TABLE")).length, 3);
  assert.match(queries[0].statement, /CREATE TABLE IF NOT EXISTS claimed_alerts/);
  assert.match(queries[1].statement, /CREATE TABLE IF NOT EXISTS poll_locks/);
  assert.match(queries[2].statement, /CREATE TABLE IF NOT EXISTS token_quality_watches/);
  assert.match(queries[3].statement, /DELETE FROM token_quality_watches/);
  assert.match(queries[4].statement, /ALTER TABLE token_quality_watches/);
  assert.match(queries[5].statement, /CREATE INDEX IF NOT EXISTS token_quality_watches_due_idx/);
  assert.deepEqual(queries.slice(6), [
    { statement: "SELECT $1", parameters: ["first"] },
    { statement: "SELECT $1", parameters: ["second"] },
  ]);
});

test("NeonDatabase retries a concurrent schema initialization race", async () => {
  /** @type {{ statement: string, parameters: unknown[] }[]} */
  const queries = [];
  let firstSchemaQuery = true;
  const database = new NeonDatabase("postgresql://example.test/neondb", {
    sql: {
      async query(statement, parameters = []) {
        queries.push({ statement, parameters });
        if (statement.startsWith("CREATE TABLE") && firstSchemaQuery) {
          firstSchemaQuery = false;
          throw Object.assign(new Error("duplicate table catalog entry"), { code: "23505" });
        }
        return [];
      },
    },
  });

  await database.query("SELECT 1");

  assert.equal(queries.filter(({ statement }) => statement.startsWith("CREATE TABLE")).length, 4);
  assert.deepEqual(queries.at(-1), { statement: "SELECT 1", parameters: [] });
});
