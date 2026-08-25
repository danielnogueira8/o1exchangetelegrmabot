import assert from "node:assert/strict";
import test from "node:test";

import { runAllPolls } from "../src/all-polls.js";
import { UNKNOWN_LAUNCH_SOURCE } from "../src/launch-sources.js";
import { NOW, qualifyingToken, rules } from "../test-support/fixtures.js";

test("o1 alerts keep their rules when a B20 token is also o1-indexed", async () => {
  const b20Token = /** @type {import("../src/types.js").O1Token} */ (qualifyingToken());
  b20Token.launch.source = "Base B20 Factory";
  const o1Token = qualifyingToken();
  const claims = new Set();
  /** @type {string[]} */
  const sources = [];

  const summary = await runAllPolls({
    chainIds: [8453],
    rules,
    now: NOW,
  b20Client: {
    async listTokens() {
      return [b20Token];
    },
    async listLaunchSources() {
      return [{ chain_id: 8453, token_address: b20Token.token.address, source: "Base B20 Factory" }];
    },
  },
    o1Client: { async listTokens() { return [o1Token]; } },
    notifier: {
      async sendTokenAlert(token) {
        sources.push(/** @type {string} */ (token.launch.source));
        return "delivered";
      },
    },
    alertStore: {
      claimAlert(chainId, address) {
        const key = `${chainId}:${address}`;
        if (claims.has(key)) return false;
        claims.add(key);
        return true;
      },
      releaseAlert() {},
    },
    logger: { info() {}, error() {} },
  });

  assert.deepEqual(sources, ["Base B20 Factory"]);
  assert.deepEqual(summary, {
    fetched: 2,
    qualified: 2,
    sent: 1,
    alreadyClaimed: 1,
    errors: 0,
  });
});

test("a failed Base source lookup never labels a Base launch as an o1 pair", async () => {
  const o1Token = qualifyingToken();
  /** @type {string[]} */
  const sources = [];

  await runAllPolls({
    chainIds: [8453],
    rules,
    now: NOW,
    b20Client: {
      async listTokens() {
        return [];
      },
      async listLaunchSources() {
        throw new Error("Base RPC unavailable");
      },
    },
    o1Client: { async listTokens() { return [o1Token]; } },
    notifier: {
      async sendTokenAlert(token) {
        sources.push(/** @type {string} */ (token.launch.source));
        return "delivered";
      },
    },
    alertStore: { claimAlert() { return true; }, releaseAlert() {} },
    logger: { info() {}, error() {} },
  });

  assert.deepEqual(sources, [UNKNOWN_LAUNCH_SOURCE]);
});
