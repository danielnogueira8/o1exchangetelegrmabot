import assert from "node:assert/strict";
import test from "node:test";

import { createCronHandler } from "../src/vercel-cron.js";
import { NOW, qualifyingToken } from "../test-support/fixtures.js";

test("the Vercel cron endpoint rejects requests without the cron secret", async () => {
  const GET = createCronHandler({
    environment: { CRON_SECRET: "test-cron-secret" },
    database: {
      async query() {
        assert.fail("unauthorized requests must not connect to Neon");
      },
    },
    logger: { info() {}, error() {} },
  });

  const response = await GET(new Request("https://example.test/api/cron"));

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { ok: false, error: "unauthorized" });
});

test("the Vercel cron endpoint skips an overlapping invocation", async () => {
  const GET = createCronHandler({
    environment: {
      CRON_SECRET: "test-cron-secret",
      DATABASE_URL: "postgresql://example.test/neondb",
      O1_API_KEY: "test-o1-key",
      DRY_RUN: "true",
    },
    database: {
      async query(statement) {
        assert.match(statement, /INSERT INTO poll_locks/);
        return [];
      },
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
  const recordedClaims = [];
  /** @type {string[]} */
  const sentAddresses = [];
  /** @type {string | undefined} */
  let lockOwner;
  /** @type {string | undefined} */
  let releasedOwner;
  const GET = createCronHandler({
    environment: {
      CRON_SECRET: "test-cron-secret",
      DATABASE_URL: "postgresql://example.test/neondb",
      O1_API_KEY: "test-o1-key",
      TELEGRAM_BOT_TOKEN: "test-bot-token",
      TELEGRAM_CHAT_ID: "test-chat-id",
      DRY_RUN: "false",
    },
    database: {
      async query(statement, parameters = []) {
        if (statement.startsWith("INSERT INTO poll_locks")) {
          lockOwner = /** @type {string} */ (parameters[1]);
          return [{ lock_name: "o1:poll-lock" }];
        }
        if (statement.startsWith("INSERT INTO claimed_alerts")) {
          recordedClaims.push(`${parameters[0]}:${parameters[1]}`);
          return [{ chain_id: 8453 }];
        }
        if (statement.startsWith("DELETE FROM poll_locks")) {
          releasedOwner = /** @type {string} */ (parameters[1]);
          return lockOwner === releasedOwner ? [{ lock_name: "o1:poll-lock" }] : [];
        }
        assert.fail(`Unexpected Neon query: ${statement}`);
      },
    },
    o1Client: {
      async listTokens(chainId) {
        return chainId === 8453 ? [qualifyingToken()] : [];
      },
    },
    b20Client: {
      async listTokens() {
        return [];
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
  assert.deepEqual(recordedClaims, ["8453:0x1234"]);
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
      DATABASE_URL: "postgresql://example.test/neondb",
      O1_API_KEY: "test-o1-key",
      DRY_RUN: "true",
    },
    database: {
      async query(statement, parameters = []) {
        if (statement.startsWith("INSERT INTO poll_locks")) {
          lockOwner = /** @type {string} */ (parameters[1]);
          return [{ lock_name: "o1:poll-lock" }];
        }
        if (statement.startsWith("DELETE FROM poll_locks")) {
          releaseCalls += 1;
          assert.equal(parameters[1], lockOwner);
          return [{ lock_name: "o1:poll-lock" }];
        }
        assert.fail(`Unexpected Neon query: ${statement}`);
      },
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
