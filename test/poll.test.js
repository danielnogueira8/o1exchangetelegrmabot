import assert from "node:assert/strict";
import test from "node:test";

import { NotificationRejectedError } from "../src/notification-error.js";
import { calculateNextPollDelay, runPoll } from "../src/poll.js";
import { NOW, qualifyingToken, rules } from "../test-support/fixtures.js";

test("the next poll is scheduled from the previous poll's start time", () => {
  assert.equal(calculateNextPollDelay(1_000, 11_000, 60_000), 50_000);
  assert.equal(calculateNextPollDelay(1_000, 71_000, 60_000), 0);
});

test("one poll claims and sends an unseen qualifying token", async () => {
  /** @type {string[]} */
  const sentAddresses = [];
  const recordedAddresses = new Set();

  const summary = await runPoll({
    chainIds: [8453],
    rules,
    now: NOW,
    o1Client: {
      async listTokens() {
        return [qualifyingToken()];
      },
    },
    notifier: {
      async sendTokenAlert(token) {
        assert.equal(recordedAddresses.has(`8453:${token.token.address}`), true);
        sentAddresses.push(token.token.address);
        return "delivered";
      },
    },
    alertStore: {
      /** @param {number} chainId @param {string} tokenAddress */
      claimAlert(chainId, tokenAddress) {
        const identity = `${chainId}:${tokenAddress.toLowerCase()}`;
        if (recordedAddresses.has(identity)) {
          return false;
        }
        recordedAddresses.add(identity);
        return true;
      },
      /** @param {number} chainId @param {string} tokenAddress */
      releaseAlert(chainId, tokenAddress) {
        recordedAddresses.delete(`${chainId}:${tokenAddress.toLowerCase()}`);
      },
    },
    logger: { info() {}, error() {} },
  });

  assert.deepEqual(sentAddresses, ["0x1234"]);
  assert.equal(recordedAddresses.has("8453:0x1234"), true);
  assert.deepEqual(summary, {
    fetched: 1,
    qualified: 1,
    sent: 1,
    alreadyClaimed: 0,
    errors: 0,
  });
});

test("one poll enriches a new alert with optional token socials", async () => {
  const listedToken = qualifyingToken();
  const detailedToken = /** @type {import("../src/types.js").O1Token} */ (
    structuredClone(listedToken)
  );
  detailedToken.token.website = "https://example.com";
  detailedToken.token.x = "https://x.com/example";
  detailedToken.token.telegram = "https://t.me/example";
  let detailRequests = 0;

  const summary = await runPoll({
    chainIds: [8453],
    rules,
    now: NOW,
    o1Client: {
      async listTokens() {
        return [listedToken];
      },
      async getTokenDetails(chainId, tokenAddress) {
        detailRequests += 1;
        assert.equal(chainId, 8453);
        assert.equal(tokenAddress, "0x1234");
        return detailedToken;
      },
    },
    notifier: {
      async sendTokenAlert(token) {
        assert.equal(token.token.website, "https://example.com");
        assert.equal(token.token.x, "https://x.com/example");
        assert.equal(token.token.telegram, "https://t.me/example");
        return "delivered";
      },
    },
    alertStore: {
      claimAlert() {
        return true;
      },
      releaseAlert() {},
    },
    logger: { info() {}, error() {} },
  });

  assert.equal(detailRequests, 1);
  assert.equal(summary.sent, 1);
});

test("stalled social lookups share one budget and fall back to base alerts", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
  const firstToken = qualifyingToken();
  const secondToken = qualifyingToken();
  secondToken.token.address = "0x5678";
  /** @type {AbortSignal | undefined} */
  let detailsSignal;
  let detailRequests = 0;
  /** @type {string[]} */
  const sentAddresses = [];

  const polling = runPoll({
    chainIds: [8453],
    rules,
    now: NOW,
    o1Client: {
      async listTokens() {
        return [firstToken, secondToken];
      },
      async getTokenDetails(_chainId, _tokenAddress, options) {
        detailRequests += 1;
        detailsSignal = options?.signal;
        return new Promise(() => {});
      },
    },
    notifier: {
      async sendTokenAlert(token) {
        sentAddresses.push(token.token.address);
        return "delivered";
      },
    },
    alertStore: {
      claimAlert() {
        return true;
      },
      releaseAlert() {},
    },
    logger: { info() {}, error() {} },
  });

  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(10_000);
  const summary = await Promise.race([
    polling,
    new Promise((resolve) => setImmediate(() => resolve(undefined))),
  ]);

  assert.notEqual(summary, undefined, "the poll remained stalled");
  assert.equal(detailRequests, 1);
  assert.equal(detailsSignal?.aborted, true);
  assert.deepEqual(sentAddresses, ["0x1234", "0x5678"]);
  assert.equal(summary?.sent, 2);
  assert.equal(summary?.errors, 1);
});

test("a failed chain does not prevent other chains from being checked", async () => {
  /** @type {string[]} */
  const sentAddresses = [];
  const recordedAddresses = new Set();
  const monadToken = qualifyingToken();
  monadToken.chain_id = 143;

  const summary = await runPoll({
    chainIds: [8453, 143],
    rules,
    now: NOW,
    o1Client: {
      async listTokens(chainId) {
        if (chainId === 8453) {
          throw new Error("Base is temporarily unavailable");
        }
        return [monadToken];
      },
    },
    notifier: {
      async sendTokenAlert(token) {
        sentAddresses.push(token.token.address);
        return "delivered";
      },
    },
    alertStore: {
      claimAlert(chainId, tokenAddress) {
        const identity = `${chainId}:${tokenAddress.toLowerCase()}`;
        if (recordedAddresses.has(identity)) {
          return false;
        }
        recordedAddresses.add(identity);
        return true;
      },
      releaseAlert(chainId, tokenAddress) {
        recordedAddresses.delete(`${chainId}:${tokenAddress.toLowerCase()}`);
      },
    },
    logger: { info() {}, error() {} },
  });

  assert.deepEqual(sentAddresses, ["0x1234"]);
  assert.deepEqual(summary, {
    fetched: 1,
    qualified: 1,
    sent: 1,
    alreadyClaimed: 0,
    errors: 1,
  });
});

test("an ambiguous Telegram failure keeps its claim and later alerts continue", async () => {
  const firstToken = qualifyingToken();
  firstToken.token.address = "0xfirst";
  const secondToken = qualifyingToken();
  secondToken.token.address = "0xsecond";
  const recordedAddresses = new Set();

  const summary = await runPoll({
    chainIds: [8453],
    rules,
    now: NOW,
    o1Client: {
      async listTokens() {
        return [firstToken, secondToken];
      },
    },
    notifier: {
      async sendTokenAlert(token) {
        if (token.token.address === "0xfirst") {
          throw new Error("Telegram is temporarily unavailable");
        }
        return "delivered";
      },
    },
    alertStore: {
      /** @param {number} chainId @param {string} tokenAddress */
      claimAlert(chainId, tokenAddress) {
        const identity = `${chainId}:${tokenAddress}`;
        if (recordedAddresses.has(identity)) {
          return false;
        }
        recordedAddresses.add(identity);
        return true;
      },
      /** @param {number} chainId @param {string} tokenAddress */
      releaseAlert(chainId, tokenAddress) {
        recordedAddresses.delete(`${chainId}:${tokenAddress}`);
      },
    },
    logger: { info() {}, error() {} },
  });

  assert.deepEqual([...recordedAddresses], ["8453:0xfirst", "8453:0xsecond"]);
  assert.deepEqual(summary, {
    fetched: 2,
    qualified: 2,
    sent: 1,
    alreadyClaimed: 0,
    errors: 1,
  });
});

test("an explicit Telegram rejection releases its claim for a later retry", async () => {
  const claimedAddresses = new Set();
  let rejectDelivery = true;
  let deliveryAttempts = 0;
  const dependencies = {
    chainIds: [8453],
    rules,
    now: NOW,
    o1Client: {
      async listTokens() {
        return [qualifyingToken()];
      },
    },
    notifier: {
      async sendTokenAlert() {
        deliveryAttempts += 1;
        if (rejectDelivery) {
          throw new NotificationRejectedError("Telegram rejected the request");
        }
        return /** @type {const} */ ("delivered");
      },
    },
    alertStore: {
      /** @param {number} chainId @param {string} tokenAddress */
      claimAlert(chainId, tokenAddress) {
        const identity = `${chainId}:${tokenAddress}`;
        if (claimedAddresses.has(identity)) {
          return false;
        }
        claimedAddresses.add(identity);
        return true;
      },
      /** @param {number} chainId @param {string} tokenAddress */
      releaseAlert(chainId, tokenAddress) {
        claimedAddresses.delete(`${chainId}:${tokenAddress}`);
      },
    },
    logger: { info() {}, error() {} },
  };

  const rejectedSummary = await runPoll(dependencies);
  assert.equal(claimedAddresses.size, 0);
  assert.equal(rejectedSummary.errors, 1);

  rejectDelivery = false;
  const deliveredSummary = await runPoll(dependencies);
  assert.equal(deliveredSummary.sent, 1);
  assert.equal(deliveryAttempts, 2);
});

test("an already-claimed token is not sent again", async () => {
  let notifierCalls = 0;

  const summary = await runPoll({
    chainIds: [8453],
    rules,
    now: NOW,
    o1Client: {
      async listTokens() {
        return [qualifyingToken()];
      },
      async getTokenDetails() {
        assert.fail("an already-claimed token must not request details");
      },
    },
    notifier: {
      async sendTokenAlert() {
        notifierCalls += 1;
        return "delivered";
      },
    },
    alertStore: {
      claimAlert() {
        return false;
      },
      releaseAlert() {
        assert.fail("an existing claim must not be released");
      },
    },
    logger: { info() {}, error() {} },
  });

  assert.equal(notifierCalls, 0);
  assert.deepEqual(summary, {
    fetched: 1,
    qualified: 1,
    sent: 0,
    alreadyClaimed: 1,
    errors: 0,
  });
});

test("a dry-run preview releases its claim for a later live run", async () => {
  let releaseCalls = 0;

  const summary = await runPoll({
    chainIds: [8453],
    rules,
    now: NOW,
    o1Client: {
      async listTokens() {
        return [qualifyingToken()];
      },
    },
    notifier: {
      async sendTokenAlert() {
        return "previewed";
      },
    },
    alertStore: {
      claimAlert() {
        return true;
      },
      releaseAlert() {
        releaseCalls += 1;
      },
    },
    logger: { info() {}, error() {} },
  });

  assert.equal(releaseCalls, 1);
  assert.deepEqual(summary, {
    fetched: 1,
    qualified: 1,
    sent: 0,
    alreadyClaimed: 0,
    errors: 0,
  });
});

test("one poll supports an asynchronous serverless alert store", async () => {
  let delivered = false;
  let claimed = false;

  const summary = await runPoll({
    chainIds: [8453],
    rules,
    now: NOW,
    o1Client: {
      async listTokens() {
        return [qualifyingToken()];
      },
    },
    notifier: {
      async sendTokenAlert() {
        assert.equal(claimed, true);
        delivered = true;
        return "delivered";
      },
    },
    alertStore: {
      async claimAlert() {
        claimed = true;
        return true;
      },
      async releaseAlert() {
        claimed = false;
      },
    },
    logger: { info() {}, error() {} },
  });

  assert.equal(delivered, true);
  assert.equal(claimed, true);
  assert.equal(summary.sent, 1);
});
