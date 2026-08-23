/** @typedef {import("./types.js").AlertRules} AlertRules */

/**
 * @param {Record<string, string | undefined>} [environment]
 */
export function loadConfig(environment = process.env) {
  const dryRun = parseBoolean(environment.DRY_RUN, false, "DRY_RUN");
  const telegramBotToken = optionalString(environment.TELEGRAM_BOT_TOKEN);
  const telegramChatId = optionalString(environment.TELEGRAM_CHAT_ID);

  if (!dryRun && telegramBotToken === undefined) {
    throw new Error("TELEGRAM_BOT_TOKEN is required when DRY_RUN is false");
  }
  if (!dryRun && telegramChatId === undefined) {
    throw new Error("TELEGRAM_CHAT_ID is required when DRY_RUN is false");
  }
  const pollIntervalSeconds = parseNumber(environment.POLL_INTERVAL_SECONDS, 60, {
    name: "POLL_INTERVAL_SECONDS",
    minimum: 30,
    maximum: 60,
  });

  return {
    o1ApiKey: requiredString(environment.O1_API_KEY, "O1_API_KEY"),
    telegramBotToken,
    telegramChatId,
    chainIds: parseChainIds(environment.CHAIN_IDS ?? "8453,143,4663"),
    market: optionalString(environment.MARKET) ?? "all",
    rules: /** @type {AlertRules} */ ({
      maximumAgeHours: parseNumber(environment.MAXIMUM_AGE_HOURS, 24, {
        name: "MAXIMUM_AGE_HOURS",
        minimum: 0,
      }),
      minimumMarketCapUsd: parseNumber(environment.MINIMUM_MARKET_CAP_USD, 50_000, {
        name: "MINIMUM_MARKET_CAP_USD",
        minimum: 0,
      }),
      minimum24HourVolumeUsd: parseNumber(environment.MINIMUM_24H_VOLUME_USD, 10_000, {
        name: "MINIMUM_24H_VOLUME_USD",
        minimum: 0,
      }),
    }),
    pollIntervalMs: pollIntervalSeconds * 1_000,
    databaseUrl: requiredString(environment.DATABASE_URL, "DATABASE_URL"),
    dryRun,
    runOnce: parseBoolean(environment.RUN_ONCE, false, "RUN_ONCE"),
  };
}

/**
 * @param {string | undefined} value
 * @param {string} name
 */
function requiredString(value, name) {
  const parsed = optionalString(value);
  if (parsed === undefined) {
    throw new Error(`${name} is required`);
  }
  return parsed;
}

/** @param {string | undefined} value */
function optionalString(value) {
  const parsed = value?.trim();
  return parsed ? parsed : undefined;
}

/**
 * @param {string | undefined} value
 * @param {boolean} fallback
 * @param {string} name
 */
function parseBoolean(value, fallback, name) {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  if (value.toLowerCase() === "true") {
    return true;
  }
  if (value.toLowerCase() === "false") {
    return false;
  }
  throw new Error(`${name} must be true or false`);
}

/**
 * @param {string | undefined} value
 * @param {number} fallback
 * @param {{ name: string, minimum: number, maximum?: number }} options
 */
function parseNumber(value, fallback, { name, minimum, maximum }) {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || (maximum !== undefined && parsed > maximum)) {
    if (maximum !== undefined) {
      throw new Error(`${name} must be between ${minimum} and ${maximum}`);
    }
    throw new Error(`${name} must be a number greater than or equal to ${minimum}`);
  }
  return parsed;
}

/** @param {string} value */
function parseChainIds(value) {
  const chainIds = value.split(",").map((part) => Number(part.trim()));
  if (
    chainIds.length === 0 ||
    chainIds.some((chainId) => !Number.isSafeInteger(chainId) || chainId <= 0)
  ) {
    throw new Error("CHAIN_IDS must be a comma-separated list of positive integers");
  }
  return [...new Set(chainIds)];
}
