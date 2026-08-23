import assert from "node:assert/strict";
import test from "node:test";

import { NeonAlertStore } from "../src/neon-alert-store.js";

test("NeonAlertStore atomically claims a normalized chain and address identity", async () => {
  /** @type {{ statement: string, parameters: unknown[] }[]} */
  const queries = [];
  let claimed = false;
  const store = new NeonAlertStore({
    async query(statement, parameters = []) {
      queries.push({ statement, parameters });
      if (statement.startsWith("INSERT INTO claimed_alerts")) {
        if (claimed) {
          return [];
        }
        claimed = true;
        return [{ chain_id: 8453 }];
      }
      if (statement.startsWith("DELETE FROM claimed_alerts")) {
        claimed = false;
      }
      return [];
    },
  });

  assert.equal(await store.claimAlert(8453, "0xAbCd"), true);
  assert.equal(await store.claimAlert(8453, "0xabcd"), false);
  await store.releaseAlert(8453, "0xABCD");
  assert.equal(await store.claimAlert(8453, "0xabcd"), true);

  assert.match(queries[0].statement, /ON CONFLICT DO NOTHING/);
  assert.deepEqual(queries.map(({ parameters }) => parameters), [
    [8453, "0xabcd"],
    [8453, "0xabcd"],
    [8453, "0xabcd"],
    [8453, "0xabcd"],
  ]);
});
