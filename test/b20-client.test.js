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
        if (request.method === "eth_getTransactionByHash") {
          assert.deepEqual(request.params, ["0xlaunch"]);
          return jsonResponse({ result: { from: "0xcaller" } });
        }
        if (request.method === "eth_getCode") {
          assert.deepEqual(request.params, ["0xcaller", "0xf123"]);
          return jsonResponse({ result: "0x" });
        }
        if (request.method === "eth_getBalance") {
          assert.deepEqual(request.params, ["0xcaller", "0xf122"]);
          return jsonResponse({ result: "0x1a055690d9db80000" });
        }
        if (request.method === "eth_getTransactionReceipt") {
          assert.deepEqual(request.params, ["0xlaunch"]);
          return jsonResponse({ result: launchReceipt() });
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

      if (String(input).startsWith("https://base.blockscout.com/api?")) {
        assert.equal(
          String(input),
          "https://base.blockscout.com/api?module=account&action=txlist&address=0xcaller&page=1&offset=1&sort=asc",
        );
        assert.ok(init?.signal);
        return jsonResponse({
          status: "1",
          result: [{ timeStamp: `${Math.floor((NOW.getTime() - 18 * 60_000) / 1_000)}` }],
        });
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

  assert.equal(requests.length, 9);
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
        alpha: {
          factory_caller: "0xcaller",
          factory_caller_type: "EOA",
          prelaunch_eth: "30",
          base_wallet_first_activity_at: "2026-08-22T11:42:00.000Z",
          initial_mint_recipients: 2,
          largest_initial_mint_share_percent: 80,
          admin_role_granted: true,
        },
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

test("B20Client still returns a qualifying launch when optional alpha RPC calls fail", async () => {
  const client = new B20Client({
    rpcUrl: "https://base-rpc.example.test",
    fetchImpl: async (input, init) => {
      if (String(input) === "https://base-rpc.example.test") {
        const request = JSON.parse(String(init?.body));
        if (request.method === "eth_blockNumber") return jsonResponse({ result: "0x10000" });
        if (request.method === "eth_getLogs") return jsonResponse({ result: [b20CreatedLog()] });
        if (request.method === "eth_getTransactionByHash") return new Response(null, { status: 503 });
        assert.fail(`unexpected RPC request: ${request.method}`);
      }
      return jsonResponse([
        {
          pairAddress: "0xpool",
          baseToken: { address: TOKEN_ADDRESS, name: "B20 Example", symbol: "B20" },
          marketCap: 150_000,
        },
      ]);
    },
  });

  const [token] = await client.listTokens(8453);

  assert.ok(token);
  assert.equal(token.launch.alpha, undefined);
});

test("B20Client keeps direct launch alpha when Blockscout is unavailable", async () => {
  const client = new B20Client({
    rpcUrl: "https://base-rpc.example.test",
    fetchImpl: async (input, init) => {
      if (String(input) === "https://base-rpc.example.test") {
        const request = JSON.parse(String(init?.body));
        if (request.method === "eth_blockNumber") return jsonResponse({ result: "0x10000" });
        if (request.method === "eth_getLogs") return jsonResponse({ result: [b20CreatedLog()] });
        if (request.method === "eth_getTransactionByHash") return jsonResponse({ result: { from: "0xcaller" } });
        if (request.method === "eth_getCode") return jsonResponse({ result: "0x" });
        if (request.method === "eth_getBalance") return jsonResponse({ result: "0x0" });
        if (request.method === "eth_getTransactionReceipt") return jsonResponse({ result: { logs: [] } });
        assert.fail(`unexpected RPC request: ${request.method}`);
      }
      if (String(input).startsWith("https://base.blockscout.com/api?")) {
        return new Response(null, { status: 503 });
      }
      return jsonResponse([
        {
          pairAddress: "0xpool",
          baseToken: { address: TOKEN_ADDRESS, name: "B20 Example", symbol: "B20" },
          marketCap: 150_000,
        },
      ]);
    },
  });

  const [token] = await client.listTokens(8453);

  assert.ok(token);
  assert.deepEqual(token.launch.alpha, {
    factory_caller: "0xcaller",
    factory_caller_type: "EOA",
    prelaunch_eth: "0",
  });
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
    transactionHash: "0xlaunch",
    ...(withTimestamp
      ? { blockTimestamp: `0x${Math.floor(NOW.getTime() / 1_000).toString(16)}` }
      : {}),
    data: encodeEventData("B20 Example", "B20", 18),
  };
}

function launchReceipt() {
  return {
    logs: [
      transferLog("0x1111111111111111111111111111111111111111", 80n),
      transferLog("0x2222222222222222222222222222222222222222", 20n),
      {
        address: TOKEN_ADDRESS,
        topics: [
          "0x2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d",
          `0x${"0".repeat(64)}`,
          `0x${"a".repeat(40).padStart(64, "0")}`,
        ],
      },
    ],
  };
}

/** @param {string} recipient @param {bigint} amount */
function transferLog(recipient, amount) {
  return {
    address: TOKEN_ADDRESS,
    topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      `0x${"0".repeat(64)}`,
      `0x${recipient.slice(2).padStart(64, "0")}`,
    ],
    data: `0x${amount.toString(16).padStart(64, "0")}`,
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
