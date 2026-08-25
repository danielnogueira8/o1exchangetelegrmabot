import assert from "node:assert/strict";
import test from "node:test";

import { NeonQualityWatchStore } from "../src/neon-quality-watch-store.js";
import { NOW, qualifyingToken } from "../test-support/fixtures.js";

test("NeonQualityWatchStore schedules and returns a token after one hour", async () => {
  /** @type {{ statement: string, parameters: unknown[] }[]} */
  const queries = [];
  const token = qualifyingToken();
  const store = new NeonQualityWatchStore({
    async query(statement, parameters = []) {
      queries.push({ statement, parameters });
      if (statement.startsWith("SELECT chain_id, token_address, token_payload")) {
        return [{ token_payload: JSON.stringify(token) }];
      }
      return [];
    },
  });

  await store.watchToken(token, NOW);
  const due = await store.listDueWatches(new Date(NOW.getTime() + 60 * 60 * 1_000));
  assert.equal(await store.claimConfirmation(token), false);
  await store.releaseConfirmationClaim(token);
  await store.removeWatch(token);

  assert.deepEqual(due, [token]);
  assert.match(queries[1].statement, /reviewed_at IS NULL/);
  assert.match(queries[0].statement, /ON CONFLICT DO NOTHING/);
  assert.deepEqual(queries[0].parameters.slice(0, 2), [8453, "0x1234"]);
  assert.equal(queries[0].parameters[3], "2026-08-22T13:00:00.000Z");
  assert.match(queries[2].statement, /^UPDATE token_quality_watches\n  SET confirmation_claimed_at/);
  assert.match(queries[3].statement, /^UPDATE token_quality_watches\n  SET confirmation_claimed_at = NULL/);
  assert.match(queries[4].statement, /^DELETE FROM token_quality_watches/);
});
