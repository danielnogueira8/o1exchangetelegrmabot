import assert from "node:assert/strict";
import test from "node:test";

import { matchesAlertRules } from "../src/token-rules.js";
import { NOW, qualifyingToken, rules } from "../test-support/fixtures.js";

test("a fresh, recent, liquid, active token qualifies", () => {
  assert.equal(matchesAlertRules(qualifyingToken(), rules, NOW), true);
});

test("a token older than the maximum age does not qualify", () => {
  const token = qualifyingToken();
  token.launch.created_at = "2026-08-22T05:59:59.000Z";

  assert.equal(matchesAlertRules(token, rules, NOW), false);
});

test("a token with a future launch timestamp does not qualify", () => {
  const token = qualifyingToken();
  token.launch.created_at = "2026-08-22T12:00:01.000Z";

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
