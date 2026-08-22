import assert from "node:assert/strict";
import test from "node:test";

import { RedisAlertStore } from "../src/redis-alert-store.js";

test("RedisAlertStore persists a normalized chain and address identity", async () => {
  const keys = new Set();
  const store = new RedisAlertStore({
    async exists(key) {
      return keys.has(key) ? 1 : 0;
    },
    async set(key) {
      keys.add(key);
      return "OK";
    },
  });

  assert.equal(await store.hasAlert(8453, "0xAbCd"), false);
  await store.recordAlert(8453, "0xAbCd");
  assert.equal(await store.hasAlert(8453, "0xabcd"), true);
  assert.deepEqual([...keys], ["o1:alerts:8453:0xabcd"]);
});

test("the Vercel poll lock blocks overlapping or duplicate cron invocations", async () => {
  /** @type {{ key: string, value: string, options: { nx?: boolean, ex?: number } | undefined }[]} */
  const calls = [];
  /** @type {string | null} */
  let result = "OK";
  const store = new RedisAlertStore({
    async exists() {
      return 0;
    },
    async set(key, value, options) {
      calls.push({ key, value, options });
      return result;
    },
  });

  assert.equal(await store.tryAcquirePollLock(), true);
  result = null;
  assert.equal(await store.tryAcquirePollLock(), false);
  assert.deepEqual(calls, [
    {
      key: "o1:poll-lock",
      value: "1",
      options: { nx: true, ex: 55 },
    },
    {
      key: "o1:poll-lock",
      value: "1",
      options: { nx: true, ex: 55 },
    },
  ]);
});
