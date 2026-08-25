import assert from "node:assert/strict";
import test from "node:test";

import { NotificationRejectedError } from "../src/notification-error.js";
import { runOneHourQualityChecks } from "../src/quality-checks.js";
import { NOW, qualifyingToken } from "../test-support/fixtures.js";

test("one-hour quality checks only confirm active paid DexScreener orders", async () => {
  const token = qualifyingToken();
  /** @type {string[]} */
  const removed = [];
  /** @type {string[]} */
  const confirmed = [];

  await runOneHourQualityChecks({
    now: NOW,
    watchStore: {
      async listDueWatches() {
        return [token];
      },
      async removeWatch(value) {
        removed.push(value.token.address);
      },
      async claimConfirmation() {
        return true;
      },
      async releaseConfirmationClaim() {},
    },
    dexScreenerClient: {
      async listActivePaidOrders() {
        return [{ type: "tokenProfile", status: "approved", paymentTimestamp: 1 }];
      },
      async getOneHourQuality() {
        return {
          liquidityUsd: 25_000,
          marketCapUsd: 150_000,
          oneHourVolumeUsd: 12_000,
          oneHourTrades: 30,
        };
      },
    },
    notifier: {
      async sendTokenAlert() {
        assert.fail("quality checks must not send another base alert");
      },
      async sendQualityConfirmation(value, orders, quality) {
        confirmed.push(`${value.token.address}:${orders[0].type}:${quality.oneHourTrades}`);
      },
    },
    logger: { error() {} },
  });

  assert.deepEqual(removed, ["0x1234"]);
  assert.deepEqual(confirmed, ["0x1234:tokenProfile:30"]);
});

test("one-hour quality checks keep a watch pending when DexScreener is unavailable", async () => {
  const token = qualifyingToken();
  let reviewed = false;

  await runOneHourQualityChecks({
    now: NOW,
    watchStore: {
      async listDueWatches() {
        return [token];
      },
      async removeWatch() {
        reviewed = true;
      },
      async claimConfirmation() {
        return true;
      },
      async releaseConfirmationClaim() {},
    },
    dexScreenerClient: {
      async listActivePaidOrders() {
        throw new Error("DexScreener unavailable");
      },
      async getOneHourQuality() {
        return undefined;
      },
    },
    notifier: { async sendTokenAlert() { return "delivered"; } },
    logger: { error() {} },
  });

  assert.equal(reviewed, false);
});

test("one-hour quality checks do not confirm a paid token that has faded", async () => {
  const token = qualifyingToken();
  let confirmed = false;

  await runOneHourQualityChecks({
    now: NOW,
    watchStore: {
      async listDueWatches() {
        return [token];
      },
      async removeWatch() {},
      async claimConfirmation() {
        return true;
      },
      async releaseConfirmationClaim() {},
    },
    dexScreenerClient: {
      async listActivePaidOrders() {
        return [{ type: "tokenProfile", status: "approved", paymentTimestamp: 1 }];
      },
      async getOneHourQuality() {
        return undefined;
      },
    },
    notifier: {
      async sendTokenAlert() {
        return "delivered";
      },
      async sendQualityConfirmation() {
        confirmed = true;
      },
    },
    logger: { error() {} },
  });

  assert.equal(confirmed, false);
});

test("one-hour quality checks keep a quality confirmation claimed after an ambiguous Telegram failure", async () => {
  const token = qualifyingToken();
  let removed = false;
  let released = false;

  await runOneHourQualityChecks({
    now: NOW,
    watchStore: {
      async listDueWatches() {
        return [token];
      },
      async removeWatch() {
        removed = true;
      },
      async claimConfirmation() {
        return true;
      },
      async releaseConfirmationClaim() {
        released = true;
      },
    },
    dexScreenerClient: {
      async listActivePaidOrders() {
        return [{ type: "tokenProfile", status: "approved", paymentTimestamp: 1 }];
      },
      async getOneHourQuality() {
        return {
          liquidityUsd: 25_000,
          marketCapUsd: 150_000,
          oneHourVolumeUsd: 12_000,
          oneHourTrades: 30,
        };
      },
    },
    notifier: {
      async sendTokenAlert() {
        return "delivered";
      },
      async sendQualityConfirmation() {
        throw new Error("Telegram unavailable");
      },
    },
    logger: { error() {} },
  });

  assert.equal(removed, false);
  assert.equal(released, false);
});

test("one-hour quality checks requeue an explicit Telegram rejection", async () => {
  const token = qualifyingToken();
  let released = false;

  await runOneHourQualityChecks({
    now: NOW,
    watchStore: {
      async listDueWatches() {
        return [token];
      },
      async removeWatch() {},
      async claimConfirmation() {
        return true;
      },
      async releaseConfirmationClaim() {
        released = true;
      },
    },
    dexScreenerClient: {
      async listActivePaidOrders() {
        return [{ type: "tokenProfile", status: "approved", paymentTimestamp: 1 }];
      },
      async getOneHourQuality() {
        return {
          liquidityUsd: 25_000,
          marketCapUsd: 150_000,
          oneHourVolumeUsd: 12_000,
          oneHourTrades: 30,
        };
      },
    },
    notifier: {
      async sendTokenAlert() {
        return "delivered";
      },
      async sendQualityConfirmation() {
        throw new NotificationRejectedError("Telegram explicitly rejected the confirmation");
      },
    },
    logger: { error() {} },
  });

  assert.equal(released, true);
});
