# o1 Exchange Telegram Bot

A small Node.js service that watches new o1 Launchpad pairs and sends one Telegram alert per qualifying pair. It polls the official o1 API, applies configurable thresholds, and stores alert identities in Neon Postgres so restarts and Vercel invocations do not create duplicates.

## Default behavior

- Polls Base (`8453`), Monad (`143`), and Robinhood Chain (`4663`)
- Requests the newest 100 tokens per chain on each poll
- Uses GitHub Actions to trigger the Vercel production endpoint every five minutes
- Requires a launch age of less than 24 hours
- Requires fresh market data
- Requires either at least $10,000 in 24-hour USD volume or a $50,000 market cap
- Adds the token's About description when published in o1 token details
- Adds Website, X, and Telegram links when they are published in the token's o1 details
- Adds a **Dismiss alert** button that deletes that alert message when tapped
- Atomically claims each alert before delivery so overlapping or retried runs cannot send duplicates
- Keeps an alert claimed after an ambiguous Telegram failure, favoring no duplicate message over an automatic retry
- Releases the claim after an explicit Telegram rejection so a later poll can retry it
- Keeps polling other chains and tokens when one request fails
- Retries temporary o1 rate limits and server errors

## Setup

Requirements: Node.js 22 or newer and npm.

```bash
npm install
cp .env.example .env
```

Fill in `.env` with an o1 key that has only the `tokens:read` scope and a pooled Neon `DATABASE_URL`. The key is created on the [o1 developer page](https://launch.o1.exchange/developers).

Before enabling Telegram, verify the feed with a single dry run:

```bash
DRY_RUN=true RUN_ONCE=true npm start
```

Dry-run alerts are printed but their temporary claims are released, so those tokens can still be delivered when live mode is enabled.

## Telegram setup

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy its bot token.
2. Start a chat with the bot, or add it to the destination group/channel.
3. Send a message in that chat and obtain its chat ID from Telegram's `getUpdates` response.
4. Add both values to `.env` and set `DRY_RUN=false`.
5. Start the monitor:

```bash
npm start
```

The first live poll sends every qualifying token in the newest-100 window that is not already in Neon. After that, each chain and token address is alerted only once.

If you are switching from an earlier SQLite or Upstash version, Neon starts with a new alert history. A qualifying pair from the preceding 24 hours can therefore be sent once again immediately after the switch.

## Configuration

| Variable | Default | Purpose |
| --- | ---: | --- |
| `O1_API_KEY` | required | Server-side o1 Launchpad key |
| `DATABASE_URL` | required | Pooled Neon Postgres connection string |
| `TELEGRAM_BOT_TOKEN` | required in live mode | Token issued by BotFather |
| `TELEGRAM_CHAT_ID` | required in live mode | Destination user, group, or channel ID |
| `TELEGRAM_WEBHOOK_SECRET` | required for dismiss buttons on Vercel | Verifies Telegram callback requests |
| `CHAIN_IDS` | `8453,143,4663` | Comma-separated chains to poll |
| `MARKET` | `all` | o1 market filter |
| `MAXIMUM_AGE_HOURS` | `24` | Pair must be younger than this age |
| `MINIMUM_MARKET_CAP_USD` | `50000` | One side of the qualification rule |
| `MINIMUM_24H_VOLUME_USD` | `10000` | Other side of the qualification rule |
| `POLL_INTERVAL_SECONDS` | `60` | Local start-to-start cadence (30–60 seconds) |
| `DRY_RUN` | `false` | Print alerts without Telegram or persistence |
| `RUN_ONCE` | `false` | Poll once and exit |
| `CRON_SECRET` | required on Vercel | Protects the cron endpoint |

Keep `.env` private. It is ignored by Git and excluded from Docker builds.

## Checks

```bash
npm run check
```

This runs static type checking and the full behavior test suite.

## Deploy on Vercel with GitHub Actions

Vercel hosts the app and GitHub Actions schedules it every five minutes at no extra cost. This public repository can use standard GitHub-hosted runners for free. This avoids Vercel Hobby's once-daily cron limit while keeping the application on Vercel. GitHub schedules are best-effort and can be delayed during periods of high load. GitHub disables scheduled workflows after 60 days without repository activity, so re-enable the workflow in Actions if the repository becomes inactive.

1. Import this GitHub repository into Vercel.
2. Create a Neon database and copy its pooled connection string.
3. Add these Production environment variables:
   - `O1_API_KEY`
   - `DATABASE_URL`
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
   - `TELEGRAM_WEBHOOK_SECRET` with a random value of at least 16 characters
   - `DRY_RUN=false`
   - `CRON_SECRET` with a random value of at least 16 characters
4. Deploy to Production.
5. In the GitHub repository, add an Actions secret named `CRON_SECRET` with exactly the same value as the Vercel variable.
6. Merge the workflow into the default branch. Scheduled GitHub workflows run from the default branch only.

The included GitHub workflow calls `https://o1exchangetelegrmabot.vercel.app/api/cron` every five minutes with that secret. The Vercel function verifies it, obtains a short Postgres lock to prevent overlapping invocations, polls all configured chains, and uses Postgres for durable deduplication. You can test it after deployment from **Actions → Trigger Vercel token monitor → Run workflow**.

To enable the dismiss button, register `https://o1exchangetelegrmabot.vercel.app/api/telegram` as the bot's Telegram webhook with the same `TELEGRAM_WEBHOOK_SECRET`. After the Vercel deployment is ready, run this from a shell where `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` are set:

```bash
curl --fail-with-body -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  --data-urlencode "url=https://o1exchangetelegrmabot.vercel.app/api/telegram" \
  --data-urlencode "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
  --data-urlencode 'allowed_updates=["callback_query"]'

curl --fail-with-body "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
```

Telegram sends only the button callback to that endpoint; the endpoint verifies its secret and deletes the matching alert.

Local `.env` values are never uploaded automatically; add secrets through the Vercel dashboard or CLI. The two required tables are created automatically on their first use.

## Run continuously with Docker

Build and start the service with its Neon environment file:

```bash
docker build -t o1-exchange-telegram-bot .
docker run -d --name o1-exchange-telegram-bot --restart unless-stopped --env-file .env o1-exchange-telegram-bot
```

Inspect its output with:

```bash
docker logs -f o1-exchange-telegram-bot
```

Neon preserves deduplication history across container and deployment restarts.
