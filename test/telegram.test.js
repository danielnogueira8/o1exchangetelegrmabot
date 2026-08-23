import assert from "node:assert/strict";
import test from "node:test";

import { NotificationRejectedError } from "../src/notification-error.js";
import { formatTokenAlert, TelegramNotifier } from "../src/telegram.js";

const NOW = new Date("2026-08-22T12:00:00.000Z");

function token() {
  return {
    chain_id: 8453,
    token: {
      address: "0x5F980Dcfc4c0fa3911554cf5ab288ed0eb13DBa3",
      name: "Example <Moon> & Co",
      symbol: "EX&",
      website: "https://example.com",
      x: "https://x.com/example",
      telegram: "https://t.me/example",
    },
    launch: {
      created_at: "2026-08-22T10:00:00.000Z",
      pool_id: "0xpool",
      creator_address: "0xC7937601a50669d3B4725d01201335ba46bc149A",
    },
    market_data: {
      data_status: "fresh",
      price: { usd: 0.0015 },
      market_cap: { usd: 150_000 },
      liquidity: { usd: 25_000 },
      activity: {
        "1h": { trades: 30, volume_usd: 12_000 },
        "6h": { trades: 80, volume_usd: 30_000 },
        "24h": { trades: 100, volume_usd: 45_000 },
      },
    },
  };
}

test("the Telegram alert is readable and HTML-safe", () => {
  const message = formatTokenAlert(token(), NOW);

  assert.deepEqual(message.split("\n"), [
    "🚀 <b>New o1 pair</b>",
    "",
    "🪙 <b>Example &lt;Moon&gt; &amp; Co (EX&amp;)</b>",
    "⛓️ Chain: Base",
    "🕒 Launched: 2h ago",
    "💵 Price: $0.0015",
    "💰 Market cap: $150,000",
    "💧 Liquidity: $25,000",
    "",
    "📊 <b>Activity</b>",
    "⚡ 1h: 30 trades · $12,000 volume",
    "📈 6h: 80 trades · $30,000 volume",
    "📅 24h: 100 trades · $45,000 volume",
    "",
    '🛒 Token: <a href="https://t.me/Sigma_buyBot?start=x699691974-0x5F980Dcfc4c0fa3911554cf5ab288ed0eb13DBa3">0x5F980Dcfc4c0fa3911554cf5ab288ed0eb13DBa3</a>',
    '👤 Creator: <a href="https://debank.com/profile/0xC7937601a50669d3B4725d01201335ba46bc149A">0xC7937601a50669d3B4725d01201335ba46bc149A</a>',
    '🔗 Socials: <a href="https://example.com">🌐 Website</a> · <a href="https://x.com/example">𝕏 X</a> · <a href="https://t.me/example">✈️ Telegram</a>',
  ]);
  assert.doesNotMatch(message, /Pool:/);
  assert.doesNotMatch(message, /Example <Moon>/);
});

test("the Telegram alert omits absent or unsafe social links", () => {
  const tokenWithoutSocials = token();
  tokenWithoutSocials.token.website = "javascript:alert('unsafe')";
  tokenWithoutSocials.token.x = "";
  tokenWithoutSocials.token.telegram = "ftp://example.com/community";

  const message = formatTokenAlert(tokenWithoutSocials, NOW);

  assert.doesNotMatch(message, /Socials:/);
  assert.doesNotMatch(message, /javascript:/);
});

test("TelegramNotifier sends the alert as HTML to the configured chat", async () => {
  /** @type {{ input: string, init: RequestInit | undefined }[]} */
  const requests = [];
  const notifier = new TelegramNotifier({
    botToken: "test-bot-token",
    chatId: "-100123456",
    fetchImpl: async (input, init) => {
      requests.push({ input: String(input), init });
      return new Response(JSON.stringify({ ok: true, result: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const delivered = await notifier.sendTokenAlert(token(), NOW);

  assert.equal(delivered, "delivered");
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].input,
    "https://api.telegram.org/bottest-bot-token/sendMessage",
  );
  assert.equal(requests[0].init?.method, "POST");
  assert.equal(new Headers(requests[0].init?.headers).get("content-type"), "application/json");
  const body = JSON.parse(String(requests[0].init?.body));
  assert.equal(body.chat_id, "-100123456");
  assert.equal(body.parse_mode, "HTML");
  assert.equal(body.disable_web_page_preview, true);
  assert.equal(body.text, formatTokenAlert(token(), NOW));
  assert.deepEqual(body.reply_markup, {
    inline_keyboard: [[{ text: "✖️ Dismiss alert", callback_data: "dismiss-alert" }]],
  });
});

test("TelegramNotifier identifies an explicit API rejection as safe to retry", async () => {
  const notifier = new TelegramNotifier({
    botToken: "test-bot-token",
    chatId: "test-chat-id",
    fetchImpl: async () =>
      new Response(JSON.stringify({ ok: false, description: "Too Many Requests" }), {
        status: 429,
        headers: { "content-type": "application/json" },
      }),
  });

  await assert.rejects(
    notifier.sendTokenAlert(token(), NOW),
    NotificationRejectedError,
  );
});
