import assert from "node:assert/strict";
import test from "node:test";

import { createCronHandler } from "../src/vercel-cron.js";
import { NOW, qualifyingToken } from "../test-support/fixtures.js";

test("the Vercel cron endpoint rejects requests without the cron secret", async () => {
  const GET = createCronHandler({
    environment: { CRON_SECRET: "test-cron-secret" },
    createRedis() {
      assert.fail("unauthorized requests must not connect to Redis");
    },
    logger: { info() {}, error() {} },
  });

  const response = await GET(new Request("https://example.test/api/cron"));

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { ok: false, error: "unauthorized" });
});

test("the Vercel cron endpoint skips an overlapping invocation", async () => {
  const GET = createCronHandler({
    environment: { CRON_SECRET: "test-cron-secret" },
    createRedis() {
      return {
        async set() {
          return null;
        },
        async del() {
          return 0;
        },
        async eval() {
          return 0;
        },
      };
    },
    logger: { info() {}, error() {} },
  });
  const request = new Request("https://example.test/api/cron", {
    headers: { authorization: "Bearer test-cron-secret" },
  });

  const response = await GET(request);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    skipped: true,
    reason: "already-running",
  });
});

test("an authorized Vercel cron invocation runs one live poll", async () => {
  /** @type {string[]} */
  const recordedKeys = [];
  /** @type {string[]} */
  const sentAddresses = [];
  /** @type {string | undefined} */
  let lockOwner;
  /** @type {string | undefined} */
  let releasedOwner;
  const GET = createCronHandler({
    environment: {
      CRON_SECRET: "test-cron-secret",
      O1_API_KEY: "test-o1-key",
      TELEGRAM_BOT_TOKEN: "test-bot-token",
      TELEGRAM_CHAT_ID: "test-chat-id",
      DRY_RUN: "false",
    },
    createRedis() {
      return {
        async set(key, value) {
          if (key === "o1:poll-lock") {
            lockOwner = value;
          } else {
            recordedKeys.push(key);
          }
          return "OK";
        },
        async del() {
          return 1;
        },
        /** @param {string} _script @param {string[]} _keys @param {string[]} args */
        async eval(_script, _keys, args) {
          releasedOwner = args[0];
          return lockOwner === releasedOwner ? 1 : 0;
        },
      };
    },
    o1Client: {
      async listTokens(chainId) {
        return chainId === 8453 ? [qualifyingToken()] : [];
      },
    },
    notifier: {
      async sendTokenAlert(token) {
        sentAddresses.push(token.token.address);
        return "delivered";
      },
    },
    now() {
      return NOW;
    },
    logger: { info() {}, error() {} },
  });
  const request = new Request("https://example.test/api/cron", {
    headers: { authorization: "Bearer test-cron-secret" },
  });

  const response = await GET(request);

  assert.equal(response.status, 200);
  assert.deepEqual(sentAddresses, ["0x1234"]);
  assert.deepEqual(recordedKeys, ["o1:alerts:8453:0x1234"]);
  assert.ok(lockOwner);
  assert.equal(releasedOwner, lockOwner);
  assert.deepEqual(await response.json(), {
    ok: true,
    summary: {
      fetched: 1,
      qualified: 1,
      sent: 1,
      alreadyClaimed: 0,
      errors: 0,
    },
  });
});

test("the Vercel cron endpoint releases its owned lock when polling fails", async () => {
  let releaseCalls = 0;
  /** @type {string | undefined} */
  let lockOwner;
  const GET = createCronHandler({
    environment: {
      CRON_SECRET: "test-cron-secret",
      O1_API_KEY: "test-o1-key",
      DRY_RUN: "true",
    },
    createRedis() {
      return {
        async set(_key, value) {
          lockOwner = value;
          return "OK";
        },
        async del() {
          return 1;
        },
        /** @param {string} _script @param {string[]} _keys @param {string[]} args */
        async eval(_script, _keys, args) {
          releaseCalls += 1;
          assert.equal(args[0], lockOwner);
          return 1;
        },
      };
    },
    now() {
      throw new Error("clock unavailable");
    },
    logger: { info() {}, error() {} },
  });
  const request = new Request("https://example.test/api/cron", {
    headers: { authorization: "Bearer test-cron-secret" },
  });

  const response = await GET(request);

  assert.equal(response.status, 500);
  assert.equal(releaseCalls, 1);
});
