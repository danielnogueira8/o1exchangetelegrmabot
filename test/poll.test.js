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
        sentAddresses.push(token.token.address);
        return true;
      },
    },
    alertStore: {
      hasAlert(chainId, tokenAddress) {
        return recordedAddresses.has(`${chainId}:${tokenAddress.toLowerCase()}`);
      },
      recordAlert(chainId, tokenAddress) {
        recordedAddresses.add(`${chainId}:${tokenAddress.toLowerCase()}`);
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
      hasAlert(chainId, tokenAddress) {
        return recordedAddresses.has(`${chainId}:${tokenAddress.toLowerCase()}`);
      },
      recordAlert(chainId, tokenAddress) {
        recordedAddresses.add(`${chainId}:${tokenAddress.toLowerCase()}`);
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

test("a failed Telegram delivery is not recorded and later alerts continue", async () => {
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
      hasAlert(chainId, tokenAddress) {
        return recordedAddresses.has(`${chainId}:${tokenAddress}`);
      },
      recordAlert(chainId, tokenAddress) {
        recordedAddresses.add(`${chainId}:${tokenAddress}`);
      },
    },
    logger: { info() {}, error() {} },
  });

  assert.deepEqual([...recordedAddresses], ["8453:0xsecond"]);
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
      hasAlert() {
        return true;
      },
      recordAlert() {
        assert.fail("duplicate alert must not be recorded again");
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

test("a dry-run preview is not recorded as delivered", async () => {
  let recordCalls = 0;

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
      hasAlert() {
        return false;
      },
      recordAlert() {
        recordCalls += 1;
      },
    },
    logger: { info() {}, error() {} },
  });

  assert.equal(recordCalls, 0);
  assert.deepEqual(summary, {
    fetched: 1,
    qualified: 1,
    sent: 0,
    alreadyAlerted: 0,
    errors: 0,
  });
});
