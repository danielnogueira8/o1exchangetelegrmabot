import { DISMISS_ALERT_CALLBACK_DATA } from "./telegram.js";

const TELEGRAM_API_BASE_URL = "https://api.telegram.org";

/**
 * @typedef {{
 *   id?: unknown,
 *   data?: unknown,
 *   message?: { chat?: { id?: unknown }, message_id?: unknown }
 * }} TelegramCallbackQuery
 */

/**
 * @param {{
 *   environment?: Record<string, string | undefined>,
 *   fetchImpl?: typeof fetch,
 *   logger?: { error(...values: unknown[]): void }
 * }} [options]
 */
export function createTelegramWebhookHandler({
  environment = process.env,
  fetchImpl = fetch,
  logger = console,
} = {}) {
  const webhookSecret = optionalString(environment.TELEGRAM_WEBHOOK_SECRET);

  /** @param {Request} request */
  return async function POST(request) {
    if (
      webhookSecret === undefined ||
      request.headers.get("x-telegram-bot-api-secret-token") !== webhookSecret
    ) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const botToken = optionalString(environment.TELEGRAM_BOT_TOKEN);
    const chatId = optionalString(environment.TELEGRAM_CHAT_ID);
    if (botToken === undefined || chatId === undefined) {
      logger.error("Telegram webhook is missing its bot configuration");
      return Response.json({ ok: false, error: "misconfigured" }, { status: 500 });
    }

    let update;
    try {
      update = await request.json();
    } catch {
      return Response.json({ ok: false, error: "invalid-update" }, { status: 400 });
    }

    const callbackQuery = callbackQueryFrom(update);
    if (callbackQuery?.data !== DISMISS_ALERT_CALLBACK_DATA) {
      return Response.json({ ok: true, ignored: true });
    }

    const callbackId = callbackQuery.id;
    const message = callbackQuery.message;
    const callbackChatId = message?.chat?.id;
    const messageId = message?.message_id;
    if (
      typeof callbackId !== "string" ||
      callbackChatId === undefined ||
      typeof messageId !== "number"
    ) {
      return Response.json({ ok: true, ignored: true });
    }

    try {
      await callTelegram(fetchImpl, botToken, "answerCallbackQuery", {
        callback_query_id: callbackId,
      });
      if (String(callbackChatId) !== chatId) {
        return Response.json({ ok: true, ignored: true });
      }
      await callTelegram(fetchImpl, botToken, "deleteMessage", {
        chat_id: chatId,
        message_id: messageId,
      });
      return Response.json({ ok: true, dismissed: true });
    } catch (error) {
      logger.error("Telegram dismiss callback failed", { error });
      return Response.json({ ok: false, error: "telegram-request-failed" }, { status: 502 });
    }
  };
}

/** @param {unknown} update @returns {TelegramCallbackQuery | undefined} */
function callbackQueryFrom(update) {
  if (typeof update !== "object" || update === null || !("callback_query" in update)) {
    return undefined;
  }
  const callbackQuery = update.callback_query;
  return /** @type {TelegramCallbackQuery | undefined} */ (
    typeof callbackQuery === "object" && callbackQuery !== null ? callbackQuery : undefined
  );
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {string} botToken
 * @param {"answerCallbackQuery" | "deleteMessage"} method
 * @param {Record<string, string | number>} body
 */
async function callTelegram(fetchImpl, botToken, method, body) {
  const response = await fetchImpl(`${TELEGRAM_API_BASE_URL}/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Telegram ${method} request failed with status ${response.status}`);
  }
  const payload = /** @type {{ ok?: boolean }} */ (await response.json());
  if (payload.ok !== true) {
    throw new Error(`Telegram ${method} request was rejected`);
  }
}

/** @param {string | undefined} value */
function optionalString(value) {
  const parsed = value?.trim();
  return parsed ? parsed : undefined;
}
