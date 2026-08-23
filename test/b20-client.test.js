import assert from "node:assert/strict";
import test from "node:test";

import { B20Client } from "../src/b20-client.js";
import { matchesAlertRules } from "../src/token-rules.js";
import { rules } from "../test-support/fixtures.js";

const TOKEN_ADDRESS = "0xb20000000000000000000094ba4b635cf111d101";
const NOW = new Date("2026-08-22T12:00:00.000Z");

test("B20Client discovers Base Factory launches and enriches them with market data", async () => {
  /** @type {{ input: string, init: RequestInit | undefined }[]} */
  const requests = [];
  const client = new B20Client({
    rpcUrl: "https://base-rpc.example.test",
    fetchImpl: async (input, init) => {
      requests.push({ input: String(input), init });
      if (String(input) === "https://base-rpc.example.test") {
        const request = JSON.parse(String(init?.body));
        if (request.method === "eth_blockNumber") {
          return jsonResponse({ result: "0x10000" });
        }
        if (request.method === "eth_getBlockByNumber") {
          assert.deepEqual(request.params, ["0xf123", false]);
          return jsonResponse({ result: { timestamp: `0x${Math.floor(NOW.getTime() / 1_000).toString(16)}` } });
        }
        assert.equal(request.method, "eth_getLogs");
        assert.deepEqual(request.params[0], {
          address: "0xB20f000000000000000000000000000000000000",
          topics: ["0xfd9bf2730513a1709722ff379a0844dfd8f997d600693c2bcc659e188bbdba0d"],
          fromBlock: "0xf1f0",
          toBlock: "latest",
        });
        return jsonResponse({ result: [b20CreatedLog({ withTimestamp: false })] });
      }

      assert.equal(
        String(input),
        `https://api.dexscreener.com/tokens/v1/base/${TOKEN_ADDRESS}`,
      );
      return jsonResponse([
        {
          chainId: "base",
          pairAddress: "0xpool",
          baseToken: { address: TOKEN_ADDRESS, name: "B20 Example", symbol: "B20" },
          priceUsd: "0.5",
          marketCap: 150_000,
          liquidity: { usd: 25_000 },
          volume: { h1: 1_000, h6: 5_000, h24: 20_000 },
          txns: {
            h1: { buys: 3, sells: 2 },
            h6: { buys: 8, sells: 7 },
            h24: { buys: 15, sells: 15 },
          },
        },
      ]);
    },
  });

  const tokens = await client.listTokens(8453);

  assert.equal(requests.length, 4);
  assert.deepEqual(tokens, [
    {
      chain_id: 8453,
      token: {
        address: TOKEN_ADDRESS,
        name: "B20 Example",
        symbol: "B20",
        decimals: 18,
        image_url: undefined,
      },
      launch: {
        created_at: NOW.toISOString(),
        pool_id: "0xpool",
        source: "Base B20 Factory",
      },
      market_data: {
        data_status: "fresh",
        price: { usd: 0.5 },
        market_cap: { usd: 150_000 },
        liquidity: { usd: 25_000 },
        activity: {
          "1h": { trades: 5, volume_usd: 1_000 },
          "6h": { trades: 15, volume_usd: 5_000 },
          "24h": { trades: 30, volume_usd: 20_000 },
        },
      },
    },
  ]);
  assert.equal(matchesAlertRules(tokens[0], rules, NOW), true);
});

test("B20Client only discovers launches on Base", async () => {
  const client = new B20Client({
    fetchImpl: async () => assert.fail("non-Base chains must not be requested"),
  });

  assert.deepEqual(await client.listTokens(143), []);
});

test("B20Client does not let volume qualify a token below its market-cap floor", async () => {
  const client = new B20Client({
    rpcUrl: "https://base-rpc.example.test",
    fetchImpl: async (input, init) => {
      if (String(input) === "https://base-rpc.example.test") {
        const request = JSON.parse(String(init?.body));
        if (request.method === "eth_blockNumber") return jsonResponse({ result: "0x10000" });
        return jsonResponse({ result: [b20CreatedLog()] });
      }
      return jsonResponse([
        {
          pairAddress: "0xpool",
          baseToken: { address: TOKEN_ADDRESS, name: "Below floor", symbol: "LOW" },
          marketCap: 99_999,
          volume: { h24: 1_000_000 },
          txns: { h24: { buys: 100, sells: 100 } },
        },
      ]);
    },
  });

  assert.deepEqual(await client.listTokens(8453), []);
});

test("B20Client does not treat FDV as market cap", async () => {
  const client = new B20Client({
    rpcUrl: "https://base-rpc.example.test",
    fetchImpl: async (input, init) => {
      if (String(input) === "https://base-rpc.example.test") {
        const request = JSON.parse(String(init?.body));
        if (request.method === "eth_blockNumber") return jsonResponse({ result: "0x10000" });
        return jsonResponse({ result: [b20CreatedLog()] });
      }
      return jsonResponse([
        {
          pairAddress: "0xpool",
          baseToken: { address: TOKEN_ADDRESS, name: "FDV only", symbol: "FDV" },
          fdv: 1_000_000,
          volume: { h24: 1_000_000 },
          txns: { h24: { buys: 100, sells: 100 } },
        },
      ]);
    },
  });

  assert.deepEqual(await client.listTokens(8453), []);
});

/** @param {{ withTimestamp?: boolean }} [options] */
function b20CreatedLog({ withTimestamp = true } = {}) {
  return {
    topics: [
      "0xfd9bf2730513a1709722ff379a0844dfd8f997d600693c2bcc659e188bbdba0d",
      `0x${TOKEN_ADDRESS.slice(2).padStart(64, "0")}`,
      `0x${"0".repeat(64)}`,
    ],
    blockNumber: "0xf123",
    ...(withTimestamp
      ? { blockTimestamp: `0x${Math.floor(NOW.getTime() / 1_000).toString(16)}` }
      : {}),
    data: encodeEventData("B20 Example", "B20", 18),
  };
}

/** @param {string} name @param {string} symbol @param {number} decimals */
function encodeEventData(name, symbol, decimals) {
  const nameData = encodeString(name);
  const symbolData = encodeString(symbol);
  const nameOffset = 32 * 4;
  const symbolOffset = nameOffset + nameData.length / 2;
  return `0x${[word(nameOffset), word(symbolOffset), word(decimals), word(symbolOffset + symbolData.length / 2), nameData, symbolData, ""].join("")}`;
}

/** @param {string} value */
function encodeString(value) {
  const valueHex = Buffer.from(value, "utf8").toString("hex");
  return `${word(valueHex.length / 2)}${valueHex.padEnd(Math.ceil(valueHex.length / 64) * 64, "0")}`;
}

/** @param {number | string} value */
function word(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

/** @param {unknown} value */
function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
