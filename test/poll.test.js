import assert from "node:assert/strict";
import test from "node:test";

import { calculateNextPollDelay, runPoll } from "../src/poll.js";
import { NOW, qualifyingToken, rules } from "../test-support/fixtures.js";

test("the next poll is scheduled from the previous poll's start time", () => {
  assert.equal(calculateNextPollDelay(1_000, 11_000, 60_000), 50_000);
  assert.equal(calculateNextPollDelay(1_000, 71_000, 60_000), 0);
});

test("one poll sends and records an unseen qualifying token", async () => {
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
        return true;
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
  assert.equal(recordedAddresses.has("8453:0x1234"), true);
  assert.deepEqual(summary, {
    fetched: 1,
    qualified: 1,
    sent: 1,
    alreadyAlerted: 0,
    errors: 0,
  });
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
        return true;
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
    alreadyAlerted: 0,
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
        return true;
      },
    },
    alertStore: {
      claimAlert(chainId, tokenAddress) {
        const identity = `${chainId}:${tokenAddress}`;
        if (recordedAddresses.has(identity)) {
          return false;
        }
        recordedAddresses.add(identity);
        return true;
      },
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
    alreadyAlerted: 0,
    errors: 1,
  });
});

test("an already-alerted token is not sent again", async () => {
  let notifierCalls = 0;

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
        notifierCalls += 1;
        return true;
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
    alreadyAlerted: 1,
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
        return false;
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
    alreadyAlerted: 0,
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
        return true;
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
