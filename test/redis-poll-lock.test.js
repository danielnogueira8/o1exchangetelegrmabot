import assert from "node:assert/strict";
import test from "node:test";

import { RedisPollLock } from "../src/redis-poll-lock.js";

test("the Vercel poll lock uses unique ownership and releases only its own lock", async () => {
  /** @type {{ key: string, value: string, options: { nx?: boolean, ex?: number } | undefined }[]} */
  const setCalls = [];
  /** @type {{ script: string, keys: string[], args: string[] }[]} */
  const evalCalls = [];
  /** @type {string | undefined} */
  let lockOwner;
  const lock = new RedisPollLock(
    {
      async set(key, value, options) {
        setCalls.push({ key, value, options });
        if (lockOwner !== undefined) {
          return null;
        }
        lockOwner = value;
        return "OK";
      },
      async eval(script, keys, args) {
        evalCalls.push({ script, keys, args });
        if (lockOwner !== args[0]) {
          return 0;
        }
        lockOwner = undefined;
        return 1;
      },
    },
    { createOwnerToken: () => "owner-1" },
  );

  assert.equal(await lock.tryAcquire(), "owner-1");
  assert.equal(await lock.tryAcquire(), null);
  assert.equal(await lock.release("another-owner"), false);
  assert.equal(await lock.release("owner-1"), true);
  assert.deepEqual(setCalls, [
    {
      key: "o1:poll-lock",
      value: "owner-1",
      options: { nx: true, ex: 55 },
    },
    {
      key: "o1:poll-lock",
      value: "owner-1",
      options: { nx: true, ex: 55 },
    },
  ]);
  assert.equal(evalCalls.length, 2);
  assert.deepEqual(evalCalls.map(({ keys, args }) => ({ keys, args })), [
    { keys: ["o1:poll-lock"], args: ["another-owner"] },
    { keys: ["o1:poll-lock"], args: ["owner-1"] },
  ]);
  assert.match(evalCalls[0].script, /redis\.call\("get", KEYS\[1\]\)/);
});
