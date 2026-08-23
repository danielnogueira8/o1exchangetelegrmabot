import assert from "node:assert/strict";
import test from "node:test";

import { NeonPollLock } from "../src/neon-poll-lock.js";

test("NeonPollLock uses unique ownership and releases only its own lock", async () => {
  /** @type {{ statement: string, parameters: unknown[] }[]} */
  const queries = [];
  /** @type {string | undefined} */
  let lockOwner;
  const lock = new NeonPollLock(
    {
      async query(statement, parameters = []) {
        queries.push({ statement, parameters });
        if (statement.startsWith("INSERT INTO poll_locks")) {
          if (lockOwner !== undefined) {
            return [];
          }
          lockOwner = /** @type {string} */ (parameters[1]);
          return [{ lock_name: "o1:poll-lock" }];
        }
        if (statement.startsWith("DELETE FROM poll_locks")) {
          if (lockOwner !== parameters[1]) {
            return [];
          }
          lockOwner = undefined;
          return [{ lock_name: "o1:poll-lock" }];
        }
        return [];
      },
    },
    { createOwnerToken: () => "owner-1" },
  );

  assert.equal(await lock.tryAcquire(), "owner-1");
  assert.equal(await lock.tryAcquire(), null);
  assert.equal(await lock.release("another-owner"), false);
  assert.equal(await lock.release("owner-1"), true);

  assert.match(queries[0].statement, /ON CONFLICT \(lock_name\) DO UPDATE/);
  assert.match(queries[0].statement, /poll_locks\.expires_at <= NOW\(\)/);
  assert.deepEqual(queries.map(({ parameters }) => parameters), [
    ["o1:poll-lock", "owner-1", 55],
    ["o1:poll-lock", "owner-1", 55],
    ["o1:poll-lock", "another-owner"],
    ["o1:poll-lock", "owner-1"],
  ]);
});
