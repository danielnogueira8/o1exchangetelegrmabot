import assert from "node:assert/strict";
import test from "node:test";

import { RedisAlertStore } from "../src/redis-alert-store.js";

test("RedisAlertStore atomically claims a normalized chain and address identity", async () => {
  const keys = new Set();
  const store = new RedisAlertStore({
    async set(key, _value, options) {
      if (options?.nx && keys.has(key)) {
        return null;
      }
      keys.add(key);
      return "OK";
    },
    async del(key) {
      return keys.delete(key) ? 1 : 0;
    },
  });

  assert.equal(await store.claimAlert(8453, "0xAbCd"), true);
  assert.equal(await store.claimAlert(8453, "0xabcd"), false);
  assert.deepEqual([...keys], ["o1:alerts:8453:0xabcd"]);

  await store.releaseAlert(8453, "0xABCD");
  assert.equal(await store.claimAlert(8453, "0xabcd"), true);
});
