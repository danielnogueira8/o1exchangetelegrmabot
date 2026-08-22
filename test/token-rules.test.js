import assert from "node:assert/strict";
import test from "node:test";

import { matchesAlertRules } from "../src/token-rules.js";
import { NOW, qualifyingToken, rules } from "../test-support/fixtures.js";

test("a fresh, recent, liquid, active token qualifies", () => {
  assert.equal(matchesAlertRules(qualifyingToken(), rules, NOW), true);
});

test("24-hour volume can qualify a new pair when market cap is below the floor", () => {
  const token = qualifyingToken();
  token.market_data.market_cap.usd = 49_999;
  token.market_data.activity["24h"].volume_usd = 10_000;

  assert.equal(
    matchesAlertRules(
      token,
      rules,
      NOW,
    ),
    true,
  );
});

test("market cap can qualify a new pair without extra liquidity or trade gates", () => {
  const token = qualifyingToken();
  token.market_data.market_cap.usd = 50_000;
  token.market_data.activity["24h"].volume_usd = 0;
  token.market_data.liquidity.usd = 0;
  token.market_data.activity["1h"].trades = 0;

  assert.equal(
    matchesAlertRules(
      token,
      rules,
      NOW,
    ),
    true,
  );
});

test("a token older than the maximum age does not qualify", () => {
  const token = qualifyingToken();
  token.launch.created_at = "2026-08-21T11:59:59.000Z";

  assert.equal(matchesAlertRules(token, rules, NOW), false);
});

test("a pair must be deployed less than 24 hours ago", () => {
  const token = qualifyingToken();
  token.launch.created_at = "2026-08-21T12:00:00.000Z";

  assert.equal(
    matchesAlertRules(
      token,
      { maximumAgeHours: 24, minimumMarketCapUsd: 50_000, minimum24HourVolumeUsd: 10_000 },
      NOW,
    ),
    false,
  );
});

test("a token with a future launch timestamp does not qualify", () => {
  const token = qualifyingToken();
  token.launch.created_at = "2026-08-22T12:00:01.000Z";

  assert.equal(matchesAlertRules(token, rules, NOW), false);
});

test("a token below both the volume and market-cap floors does not qualify", () => {
  const token = qualifyingToken();
  token.market_data.market_cap.usd = 49_999;
  token.market_data.activity["24h"].volume_usd = 9_999;

  assert.equal(matchesAlertRules(token, rules, NOW), false);
});

test("market data must be fresh", () => {
  const token = qualifyingToken();
  token.market_data.data_status = "stale";

  assert.equal(matchesAlertRules(token, rules, NOW), false);
});
