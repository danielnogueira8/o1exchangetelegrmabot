import assert from "node:assert/strict";
import test from "node:test";

import { matchesAlertRules } from "../src/token-rules.js";

const NOW = new Date("2026-08-22T12:00:00.000Z");

function qualifyingToken() {
  return {
    chain_id: 8453,
    token: {
      address: "0x1234",
      name: "Example Token",
      symbol: "EXAMPLE",
    },
    launch: {
      created_at: "2026-08-22T10:00:00.000Z",
      pool_id: "0xabcd",
      creator_address: "0xcreator",
    },
    market_data: {
      data_status: "fresh",
      market_cap: { usd: 150_000 },
      liquidity: { usd: 25_000 },
      activity: {
        "1h": { trades: 30, volume_usd: 12_000 },
        "6h": { trades: 80, volume_usd: 30_000 },
        "24h": { trades: 80, volume_usd: 30_000 },
      },
      price: { usd: 0.0015 },
    },
  };
}

const rules = {
  maximumAgeHours: 6,
  minimumMarketCapUsd: 100_000,
  minimumLiquidityUsd: 10_000,
  minimumOneHourTrades: 20,
};

test("a fresh, recent, liquid, active token qualifies", () => {
  assert.equal(matchesAlertRules(qualifyingToken(), rules, NOW), true);
});

test("a token older than the maximum age does not qualify", () => {
  const token = qualifyingToken();
  token.launch.created_at = "2026-08-22T05:59:59.000Z";

  assert.equal(matchesAlertRules(token, rules, NOW), false);
});

test("a token below the market-cap floor does not qualify", () => {
  const token = qualifyingToken();
  token.market_data.market_cap.usd = 99_999;

  assert.equal(matchesAlertRules(token, rules, NOW), false);
});

test("market data must be fresh", () => {
  const token = qualifyingToken();
  token.market_data.data_status = "stale";

  assert.equal(matchesAlertRules(token, rules, NOW), false);
});

test("a token below the liquidity floor does not qualify", () => {
  const token = qualifyingToken();
  token.market_data.liquidity.usd = 9_999;

  assert.equal(matchesAlertRules(token, rules, NOW), false);
});

test("a token below the one-hour trade floor does not qualify", () => {
  const token = qualifyingToken();
  token.market_data.activity["1h"].trades = 19;

  assert.equal(matchesAlertRules(token, rules, NOW), false);
});
