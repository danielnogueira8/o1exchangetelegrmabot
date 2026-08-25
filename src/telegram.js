import { NotificationRejectedError } from "./notification-error.js";
import { BASE_B20_FACTORY_SOURCE, UNKNOWN_LAUNCH_SOURCE } from "./launch-sources.js";

/** @typedef {import("./types.js").O1Token} O1Token */
/** @typedef {import("./types.js").TokenActivity} TokenActivity */
/** @typedef {import("./types.js").OneHourQuality} OneHourQuality */
/** @typedef {import("./types.js").PaidDexScreenerOrder} PaidDexScreenerOrder */
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

  /** @param {O1Token} token @param {PaidDexScreenerOrder[]} orders @param {OneHourQuality} quality @param {Date} [now] */
  async sendQualityConfirmation(token, orders, quality, now = new Date()) {
    const response = await this.#fetch(
      `https://api.telegram.org/bot${this.#botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: this.#chatId,
          text: formatQualityConfirmation(token, orders, quality, now),
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

  /** @param {O1Token} token @param {PaidDexScreenerOrder[]} orders @param {OneHourQuality} quality @param {Date} [now] */
  async sendQualityConfirmation(token, orders, quality, now = new Date()) {
    this.#logger.info(`[dry-run]\n${formatQualityConfirmation(token, orders, quality, now)}`);
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
    formatAlertTitle(token.launch.source),
    "",
    `🪙 <b>${escapeHtml(token.token.name)} (${escapeHtml(token.token.symbol)})</b>`,
    `⛓️ Chain: ${escapeHtml(chainName)}`,
    `🕒 Launched: ${formatAge(token.launch.created_at, now)} ago`,
    ...formatLaunchSource(token.launch.source),
    ...formatLaunchAlpha(token.launch.alpha, now),
    `💵 Price: ${formatPrice(marketData?.price?.usd)}`,
    `💰 Market cap: ${formatWholeUsd(marketData?.market_cap?.usd)}`,
    `💧 Liquidity: ${formatWholeUsd(marketData?.liquidity?.usd)}`,
    ...formatDescription(token.token.description),
    "",
    "📊 <b>Activity</b>",
    formatActivity("1h", marketData),
    formatActivity("6h", marketData),
    formatActivity("24h", marketData),
    "",
    `🛒 Token: ${formatLink(token.token.address, sigmaBuyUrl(token.token.address))}`,
    ...formatCreator(token.launch.creator_address),
    ...formatSocialLinks(token.token),
  ].join("\n");
}

/** @param {O1Token} token @param {PaidDexScreenerOrder[]} orders @param {OneHourQuality} quality @param {Date} [now] */
export function formatQualityConfirmation(token, orders, quality, now = new Date()) {
  const orderTypes = [...new Set(orders.map(({ type }) => readableOrderType(type)))];
  return [
    "✅ <b>1h quality confirmation</b>",
    "",
    `🪙 <b>${escapeHtml(token.token.name)} (${escapeHtml(token.token.symbol)})</b>`,
    `⏱️ Tracked: ${formatAge(token.launch.created_at, now)} ago`,
    `💳 Active paid DexScreener: ${escapeHtml(orderTypes.join(" · "))}`,
    `💧 Liquidity: ${formatWholeUsd(quality.liquidityUsd)}`,
    `⚡ 1h: ${quality.oneHourTrades.toLocaleString("en-US")} trades · ${formatWholeUsd(quality.oneHourVolumeUsd)} volume`,
    `🛒 Token: ${formatLink(token.token.address, sigmaBuyUrl(token.token.address))}`,
  ].join("\n");
}

/** @param {string} type */
function readableOrderType(type) {
  return new Map([
    ["tokenProfile", "Token profile"],
    ["communityTakeover", "Community takeover"],
    ["tokenAd", "Token ad"],
    ["trendingBarAd", "Trending bar ad"],
  ]).get(type) ?? type;
}

/** @param {string | undefined} source */
function formatAlertTitle(source) {
  if (source?.trim() === BASE_B20_FACTORY_SOURCE) {
    return "🚀 <b>New Base B20 launch</b>";
  }
  if (source?.trim() === UNKNOWN_LAUNCH_SOURCE) {
    return "🚀 <b>New launch</b>";
  }
  return source?.trim() ? "🚀 <b>New launch</b>" : "🚀 <b>New o1 pair</b>";
}

/** @param {string | undefined} creatorAddress */
function formatCreator(creatorAddress) {
  const address = creatorAddress?.trim();
  return address
    ? [`👤 Creator: ${formatLink(address, debankProfileUrl(address))}`]
    : [];
}

/** @param {string | undefined} source */
function formatLaunchSource(source) {
  const value = source?.trim();
  return value && value !== UNKNOWN_LAUNCH_SOURCE
    ? [`🏭 Launch source: ${escapeHtml(value)}`]
    : [];
}

/** @param {O1Token["launch"]["alpha"]} alpha @param {Date} now */
function formatLaunchAlpha(alpha, now) {
  if (alpha === undefined) {
    return [];
  }

  const lines = ["🧪 <b>Launch alpha</b>"];
  if (alpha.factory_caller) {
    const type = alpha.factory_caller_type ? ` (${alpha.factory_caller_type})` : "";
    lines.push(`👤 Factory caller: ${formatLink(alpha.factory_caller, debankProfileUrl(alpha.factory_caller))}${type}`);
  }
  if (alpha.prelaunch_eth !== undefined) {
    lines.push(`💰 Pre-launch ETH: ${escapeHtml(alpha.prelaunch_eth)} ETH`);
  }
  if (alpha.base_wallet_first_activity_at !== undefined) {
    const age = formatAge(alpha.base_wallet_first_activity_at, now);
    const isNew = now.getTime() - Date.parse(alpha.base_wallet_first_activity_at) < 24 * 60 * 60 * 1_000;
    lines.push(`🆕 Base first observed activity: ${age}${isNew ? " ⚠️ New on Base" : ""}`);
  }
  if (alpha.initial_mint_recipients !== undefined) {
    const share = alpha.largest_initial_mint_share_percent;
    const concentration = share === undefined ? "" : ` · largest ${share.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
    lines.push(`📦 Initial mint: ${alpha.initial_mint_recipients} recipient${alpha.initial_mint_recipients === 1 ? "" : "s"}${concentration}`);
  }
  if (alpha.admin_role_granted !== undefined) {
    lines.push(`🛡️ Default admin grant in launch: ${alpha.admin_role_granted ? "yes" : "no"}`);
  }
  return lines.length > 1 ? lines : [];
}

/** @param {string | undefined} description */
function formatDescription(description) {
  const value = description?.trim();
  return value ? [`📝 About: ${escapeHtml(value)}`] : [];
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
