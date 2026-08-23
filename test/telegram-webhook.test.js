import assert from "node:assert/strict";
import test from "node:test";

import { createTelegramWebhookHandler } from "../src/telegram-webhook.js";

const environment = {
  TELEGRAM_BOT_TOKEN: "test-bot-token",
  TELEGRAM_CHAT_ID: "-100123456",
  TELEGRAM_WEBHOOK_SECRET: "test-webhook-secret",
};

function dismissRequest({ secret = "test-webhook-secret", chatId = -100123456 } = {}) {
  return new Request("https://example.test/api/telegram", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": secret,
    },
    body: JSON.stringify({
      callback_query: {
        id: "callback-1",
        data: "dismiss-alert",
        message: { chat: { id: chatId }, message_id: 42 },
      },
    }),
  });
}

test("the Telegram webhook rejects a callback without its secret", async () => {
  const handler = createTelegramWebhookHandler({
    environment,
    fetchImpl: async () => assert.fail("unauthorized callbacks must not call Telegram"),
  });

  const response = await handler(dismissRequest({ secret: "wrong-secret" }));

  assert.equal(response.status, 401);
});

test("the Telegram webhook acknowledges and deletes a dismissed alert", async () => {
  /** @type {{ input: string, init: RequestInit | undefined }[]} */
  const requests = [];
  const handler = createTelegramWebhookHandler({
    environment,
    fetchImpl: async (input, init) => {
      requests.push({ input: String(input), init });
      return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
    },
  });

  const response = await handler(dismissRequest());

  assert.equal(response.status, 200);
  assert.deepEqual(
    requests.map(({ input, init }) => ({ input, body: JSON.parse(String(init?.body)) })),
    [
      {
        input: "https://api.telegram.org/bottest-bot-token/answerCallbackQuery",
        body: { callback_query_id: "callback-1" },
      },
      {
        input: "https://api.telegram.org/bottest-bot-token/deleteMessage",
        body: { chat_id: "-100123456", message_id: 42 },
      },
    ],
  );
});

test("the Telegram webhook will not delete an alert from another chat", async () => {
  /** @type {{ input: string, init: RequestInit | undefined }[]} */
  const requests = [];
  const handler = createTelegramWebhookHandler({
    environment,
    fetchImpl: async (input, init) => {
      requests.push({ input: String(input), init });
      return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
    },
  });

  const response = await handler(dismissRequest({ chatId: -100999999 }));

  assert.equal(response.status, 200);
  assert.equal(requests.length, 1);
  assert.match(requests[0].input, /answerCallbackQuery$/);
});
