import assert from "node:assert/strict";
import test from "node:test";

import { formatTokenAlert, TelegramNotifier } from "../src/telegram.js";

const NOW = new Date("2026-08-22T12:00:00.000Z");

function token() {
  return {
    chain_id: 8453,
    token: {
      address: "0x<token>",
      name: "Example <Moon> & Co",
      symbol: "EX&",
    },
    launch: {
      created_at: "2026-08-22T10:00:00.000Z",
      pool_id: "0xpool",
      creator_address: "0xcreator",
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

  assert.match(message, /<b>Example &lt;Moon&gt; &amp; Co \(EX&amp;\)<\/b>/);
  assert.match(message, /Chain: Base/);
  assert.match(message, /Launched: 2h ago/);
  assert.match(message, /Price: \$0\.0015/);
  assert.match(message, /Market cap: \$150,000/);
  assert.match(message, /Liquidity: \$25,000/);
  assert.match(message, /1h: 30 trades · \$12,000 volume/);
  assert.match(message, /Token: <code>0x&lt;token&gt;<\/code>/);
  assert.doesNotMatch(message, /Example <Moon>/);
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

  assert.equal(delivered, true);
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
});
