import { NotificationRejectedError } from "./notification-error.js";

/** @typedef {import("./types.js").O1Token} O1Token */
/** @typedef {import("./types.js").TokenActivity} TokenActivity */
/** @typedef {"1h" | "6h" | "24h"} ActivityPeriod */

const CHAIN_NAMES = new Map([
  [8453, "Base"],
  [143, "Monad"],
  [4663, "Robinhood Chain"],
]);
const SIGMA_BUY_BOT_URL = "https://t.me/Sigma_buyBot";
const SIGMA_START_PREFIX = "x699691974";
const DEBANK_PROFILE_URL = "https://debank.com/profile/";
export const DISMISS_ALERT_CALLBACK_DATA = "dismiss-alert";
const ACTIVITY_ICONS = new Map([
  ["1h", "⚡"],
  ["6h", "📈"],
  ["24h", "📅"],
]);

const wholeUsdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export class TelegramNotifier {
  /** @type {string} */
  #botToken;

  /** @type {string} */
  #chatId;

  /** @type {typeof fetch} */
  #fetch;

  /**
   * @param {{ botToken: string, chatId: string, fetchImpl?: typeof fetch }} options
   */
  constructor({ botToken, chatId, fetchImpl = fetch }) {
    this.#botToken = botToken;
    this.#chatId = chatId;
    this.#fetch = fetchImpl;
  }

  /**
   * @param {O1Token} token
   * @param {Date} [now]
   */
  async sendTokenAlert(token, now = new Date()) {
    const response = await this.#fetch(
      `https://api.telegram.org/bot${this.#botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: this.#chatId,
          text: formatTokenAlert(token, now),
          parse_mode: "HTML",
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [
              [{ text: "✖️ Dismiss alert", callback_data: DISMISS_ALERT_CALLBACK_DATA }],
            ],
          },
        }),
      },
    );

    if (!response.ok) {
      throw new NotificationRejectedError(
        `Telegram rejected the request with status ${response.status}`,
      );
    }

    const payload = /** @type {{ ok?: boolean }} */ (await response.json());
    if (payload.ok !== true) {
      throw new NotificationRejectedError("Telegram rejected the request payload");
    }

    return /** @type {const} */ ("delivered");
  }
}

export class ConsoleNotifier {
  /** @type {{ info(...values: unknown[]): void }} */
  #logger;

  /** @param {{ logger?: { info(...values: unknown[]): void } }} [options] */
  constructor({ logger = console } = {}) {
    this.#logger = logger;
  }

  /**
   * @param {O1Token} token
   * @param {Date} [now]
   */
  async sendTokenAlert(token, now = new Date()) {
    this.#logger.info(`[dry-run]\n${formatTokenAlert(token, now)}`);
    return /** @type {const} */ ("previewed");
  }
}

/**
 * @param {O1Token} token
 * @param {Date} [now]
 */
export function formatTokenAlert(token, now = new Date()) {
  const marketData = token.market_data;
  const chainName = CHAIN_NAMES.get(token.chain_id) ?? `Chain ${token.chain_id}`;

  return [
    "🚀 <b>New o1 pair</b>",
    "",
    `🪙 <b>${escapeHtml(token.token.name)} (${escapeHtml(token.token.symbol)})</b>`,
    `⛓️ Chain: ${escapeHtml(chainName)}`,
    `🕒 Launched: ${formatAge(token.launch.created_at, now)} ago`,
    `💵 Price: ${formatPrice(marketData?.price?.usd)}`,
    `💰 Market cap: ${formatWholeUsd(marketData?.market_cap?.usd)}`,
    `💧 Liquidity: ${formatWholeUsd(marketData?.liquidity?.usd)}`,
    "",
    "📊 <b>Activity</b>",
    formatActivity("1h", marketData),
    formatActivity("6h", marketData),
    formatActivity("24h", marketData),
    "",
    `🛒 Token: ${formatLink(token.token.address, sigmaBuyUrl(token.token.address))}`,
    `👤 Creator: ${formatLink(
      token.launch.creator_address,
      debankProfileUrl(token.launch.creator_address),
    )}`,
    ...formatSocialLinks(token.token),
  ].join("\n");
}

/** @param {O1Token["token"]} token */
function formatSocialLinks(token) {
  const links = [
    formatSocialLink("🌐 Website", token.website),
    formatSocialLink("𝕏 X", token.x),
    formatSocialLink("✈️ Telegram", token.telegram),
  ].filter((link) => link !== undefined);

  return links.length > 0 ? [`🔗 Socials: ${links.join(" · ")}`] : [];
}

/**
 * @param {string} label
 * @param {string | undefined} value
 */
function formatSocialLink(label, value) {
  const url = safeHttpUrl(value);
  return url === undefined ? undefined : formatLink(label, url);
}

/** @param {string | undefined} value */
function safeHttpUrl(value) {
  const candidate = value?.trim();
  if (!candidate) {
    return undefined;
  }

  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? candidate : undefined;
  } catch {
    return undefined;
  }
}

/**
 * @param {string} label
 * @param {string} url
 */
function formatLink(label, url) {
  return `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
}

/** @param {string} tokenAddress */
function sigmaBuyUrl(tokenAddress) {
  const url = new URL(SIGMA_BUY_BOT_URL);
  url.searchParams.set("start", `${SIGMA_START_PREFIX}-${tokenAddress.trim()}`);
  return url.toString();
}

/** @param {string} creatorAddress */
function debankProfileUrl(creatorAddress) {
  return `${DEBANK_PROFILE_URL}${encodeURIComponent(creatorAddress.trim())}`;
}

/**
 * @param {ActivityPeriod} period
 * @param {O1Token["market_data"]} marketData
 */
function formatActivity(period, marketData) {
  const icon = ACTIVITY_ICONS.get(period) ?? "📊";
  /** @type {TokenActivity | undefined} */
  const activity = marketData?.activity?.[period];
  const trades = activity?.trades;
  const tradeLabel = trades === 1 ? "trade" : "trades";
  const formattedTrades = typeof trades === "number" ? trades.toLocaleString("en-US") : "n/a";
  return `${icon} ${period}: ${formattedTrades} ${tradeLabel} · ${formatWholeUsd(activity?.volume_usd)} volume`;
}

/** @param {number | undefined} value */
function formatWholeUsd(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? wholeUsdFormatter.format(value)
    : "n/a";
}

/** @param {number | undefined} value */
function formatPrice(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }

  return `$${value.toLocaleString("en-US", {
    maximumFractionDigits: 12,
    maximumSignificantDigits: 8,
  })}`;
}

/**
 * @param {string} createdAt
 * @param {Date} now
 */
function formatAge(createdAt, now) {
  const ageMilliseconds = Math.max(0, now.getTime() - Date.parse(createdAt));
  const ageMinutes = Math.floor(ageMilliseconds / 60_000);

  if (ageMinutes < 60) {
    return `${ageMinutes}m`;
  }

  const ageHours = Math.floor(ageMinutes / 60);
  if (ageHours < 24) {
    return `${ageHours}h`;
  }

  return `${Math.floor(ageHours / 24)}d`;
}

/** @param {string} value */
function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
