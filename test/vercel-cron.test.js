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
        async exists() {
          return 0;
        },
        async set() {
          return null;
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
        async exists() {
          return 0;
        },
        async set(key) {
          if (key !== "o1:poll-lock") {
            recordedKeys.push(key);
          }
          return "OK";
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
        return true;
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
  assert.deepEqual(await response.json(), {
    ok: true,
    summary: {
      fetched: 1,
      qualified: 1,
      sent: 1,
      alreadyAlerted: 0,
      errors: 0,
    },
  });
});
