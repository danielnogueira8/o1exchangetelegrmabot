import assert from "node:assert/strict";
import test from "node:test";

import { DexScreenerClient } from "../src/dexscreener-client.js";

test("DexScreenerClient keeps only active paid orders", async () => {
  /** @type {{ input: string, init: RequestInit | undefined }[]} */
  const requests = [];
  const client = new DexScreenerClient({
    fetchImpl: async (input, init) => {
      requests.push({ input: String(input), init });
      return jsonResponse([
        { type: "tokenProfile", status: "approved", paymentTimestamp: 1 },
        { type: "tokenAd", status: "processing", paymentTimestamp: 2 },
        { type: "trendingBarAd", status: "cancelled", paymentTimestamp: 3 },
        { type: "communityTakeover", status: "approved" },
      ]);
    },
  });

  const orders = await client.listActivePaidOrders(8453, "0xAbCd");

  assert.deepEqual(orders, [
    { type: "tokenProfile", status: "approved", paymentTimestamp: 1 },
    { type: "tokenAd", status: "processing", paymentTimestamp: 2 },
  ]);
  assert.equal(requests[0].input, "https://api.dexscreener.com/orders/v1/base/0xAbCd");
  assert.ok(requests[0].init?.signal);
});

test("DexScreenerClient skips unsupported chains without an HTTP request", async () => {
  const client = new DexScreenerClient({
    fetchImpl: async () => assert.fail("unsupported chains should not hit DexScreener"),
  });

  assert.deepEqual(await client.listActivePaidOrders(1, "0xAbCd"), []);
});

test("DexScreenerClient confirms only sustained one-hour market health", async () => {
  const client = new DexScreenerClient({
    fetchImpl: async (input) => {
      assert.equal(
        String(input),
        "https://api.dexscreener.com/token-pairs/v1/base/0xAbCd",
      );
      return jsonResponse([
        {
          liquidity: { usd: 40_000 },
          marketCap: 500_000,
          volume: { h1: 100_000 },
          txns: { h1: { buys: 2, sells: 3 } },
        },
        {
          liquidity: { usd: 25_000 },
          marketCap: 55_000,
          volume: { h1: 500 },
          txns: { h1: { buys: 15, sells: 10 } },
        },
      ]);
    },
  });

  assert.deepEqual(await client.getOneHourQuality(8453, "0xAbCd"), {
    liquidityUsd: 25_000,
    marketCapUsd: 55_000,
    oneHourVolumeUsd: 500,
    oneHourTrades: 25,
  });
});

/** @param {unknown} value */
function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
