import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../src/config.js";

test("dry-run configuration loads safe defaults without Telegram credentials", () => {
  const config = loadConfig({
    O1_API_KEY: "test-o1-key",
    DRY_RUN: "true",
  });

  assert.deepEqual(config, {
    o1ApiKey: "test-o1-key",
    telegramBotToken: undefined,
    telegramChatId: undefined,
    chainIds: [8453, 143, 4663],
    market: "all",
    rules: {
      maximumAgeHours: 6,
      minimumMarketCapUsd: 100_000,
      minimumLiquidityUsd: 10_000,
      minimumOneHourTrades: 20,
    },
    pollIntervalMs: 60_000,
    sqlitePath: "./data/alerts.sqlite",
    dryRun: true,
    runOnce: false,
  });
});

test("live mode requires both Telegram credentials", () => {
  assert.throws(
    () => loadConfig({ O1_API_KEY: "test-o1-key", DRY_RUN: "false" }),
    /TELEGRAM_BOT_TOKEN is required when DRY_RUN is false/,
  );

  assert.throws(
    () =>
      loadConfig({
        O1_API_KEY: "test-o1-key",
        TELEGRAM_BOT_TOKEN: "test-bot-token",
        DRY_RUN: "false",
      }),
    /TELEGRAM_CHAT_ID is required when DRY_RUN is false/,
  );
});
