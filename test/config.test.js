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
      maximumAgeHours: 24,
      minimumMarketCapUsd: 50_000,
      minimum24HourVolumeUsd: 10_000,
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

test("polling must stay within the requested 30-to-60-second window", () => {
  for (const pollInterval of ["29", "61"]) {
    assert.throws(
      () =>
        loadConfig({
          O1_API_KEY: "test-o1-key",
          DRY_RUN: "true",
          POLL_INTERVAL_SECONDS: pollInterval,
        }),
      /POLL_INTERVAL_SECONDS must be between 30 and 60/,
    );
  }
});
