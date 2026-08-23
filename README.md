# o1 Exchange Telegram Bot

A small Node.js service that watches new o1 Launchpad pairs and sends one Telegram alert per qualifying pair. It polls the official o1 API, applies configurable thresholds, and stores alert identities so restarts do not create duplicates. Local and Docker runs use SQLite; Vercel uses Upstash Redis.

## Default behavior

- Polls Base (`8453`), Monad (`143`), and Robinhood Chain (`4663`)
- Requests the newest 100 tokens per chain every 60 seconds
- Requires a launch age of less than 24 hours
- Requires fresh market data
- Requires either at least $10,000 in 24-hour USD volume or a $50,000 market cap
- Adds Website, X, and Telegram links when they are published in the token's o1 details
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

Fill in `.env` with an o1 key that has only the `tokens:read` scope. The key is created on the [o1 developer page](https://launch.o1.exchange/developers).

Before enabling Telegram, verify the feed with a single dry run:

```bash
DRY_RUN=true RUN_ONCE=true npm start
```

Dry-run alerts are printed but are not stored in SQLite. This means those tokens can still be delivered when live mode is enabled.

## Telegram setup

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy its bot token.
2. Start a chat with the bot, or add it to the destination group/channel.
3. Send a message in that chat and obtain its chat ID from Telegram's `getUpdates` response.
4. Add both values to `.env` and set `DRY_RUN=false`.
5. Start the monitor:

```bash
npm start
```

The first live poll sends every qualifying token in the newest-100 window that is not already in SQLite. After that, each chain and token address is alerted only once.

## Configuration

| Variable | Default | Purpose |
| --- | ---: | --- |
| `O1_API_KEY` | required | Server-side o1 Launchpad key |
| `TELEGRAM_BOT_TOKEN` | required in live mode | Token issued by BotFather |
| `TELEGRAM_CHAT_ID` | required in live mode | Destination user, group, or channel ID |
| `CHAIN_IDS` | `8453,143,4663` | Comma-separated chains to poll |
| `MARKET` | `all` | o1 market filter |
| `MAXIMUM_AGE_HOURS` | `24` | Pair must be younger than this age |
| `MINIMUM_MARKET_CAP_USD` | `50000` | One side of the qualification rule |
| `MINIMUM_24H_VOLUME_USD` | `10000` | Other side of the qualification rule |
| `POLL_INTERVAL_SECONDS` | `60` | Local start-to-start cadence (30–60 seconds) |
| `SQLITE_PATH` | `./data/alerts.sqlite` | Persistent alert database |
| `DRY_RUN` | `false` | Print alerts without Telegram or persistence |
| `RUN_ONCE` | `false` | Poll once and exit |
| `CRON_SECRET` | required on Vercel | Protects the cron endpoint |
| `UPSTASH_REDIS_REST_URL` | required on Vercel | Added by the Upstash integration |
| `UPSTASH_REDIS_REST_TOKEN` | required on Vercel | Added by the Upstash integration |

Keep `.env` private. It is ignored by Git and excluded from Docker builds.

## Checks

```bash
npm run check
```

This runs static type checking and the full behavior test suite.

## Deploy on Vercel

Vercel's one-minute cron schedule requires a **Pro or Enterprise plan**. Hobby cron jobs can run only once per day, so Hobby cannot provide this bot's intended alert speed.

1. Import this GitHub repository into Vercel.
2. In the Vercel project, open **Storage**, create an **Upstash Redis** database, and connect it to the project. Vercel will add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` automatically.
3. Add these Production environment variables:
   - `O1_API_KEY`
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
   - `DRY_RUN=false`
   - `CRON_SECRET` with a random value of at least 16 characters
4. Deploy to Production.

The included `vercel.json` invokes `/api/cron` every minute. The function verifies `CRON_SECRET`, obtains a short Redis lock to prevent overlapping invocations, polls all configured chains, and uses Redis keys for durable deduplication. Vercel only runs cron jobs for Production deployments.

Local `.env` values are never uploaded automatically; add secrets through the Vercel dashboard or CLI. Do not configure `SQLITE_PATH` on Vercel because Vercel Functions do not provide a persistent writable filesystem.

## Run continuously with Docker

Build and start the service with a persistent SQLite volume:

```bash
docker compose up -d --build
```

Inspect its output with:

```bash
docker compose logs -f bot
```

The container restarts automatically unless explicitly stopped. The `o1-alert-data` volume preserves deduplication history across deployments.
