# o1 Exchange Telegram Bot

A small Node.js service that watches new o1 Launchpad tokens and sends one Telegram alert per qualifying token. It polls the official o1 API, applies configurable quality thresholds, and stores delivered alerts in SQLite so restarts do not create duplicates.

## Default behavior

- Polls Base (`8453`), Monad (`143`), and Robinhood Chain (`4663`)
- Requests the newest 100 tokens per chain every 60 seconds
- Requires a launch age of at most 6 hours
- Requires fresh market data
- Requires at least $100,000 market cap
- Requires at least $10,000 liquidity
- Requires at least 20 trades in the last hour
- Records an alert only after Telegram confirms delivery
- Keeps polling other chains and tokens when one request fails

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
| `MAXIMUM_AGE_HOURS` | `6` | Maximum token age |
| `MINIMUM_MARKET_CAP_USD` | `100000` | Minimum USD market cap |
| `MINIMUM_LIQUIDITY_USD` | `10000` | Minimum USD liquidity |
| `MINIMUM_1H_TRADES` | `20` | Minimum number of trades in the last hour |
| `POLL_INTERVAL_SECONDS` | `60` | Start-to-start cadence (30–60 seconds) |
| `SQLITE_PATH` | `./data/alerts.sqlite` | Persistent alert database |
| `DRY_RUN` | `false` | Print alerts without Telegram or persistence |
| `RUN_ONCE` | `false` | Poll once and exit |

Keep `.env` private. It is ignored by Git and excluded from Docker builds.

## Checks

```bash
npm run check
```

This runs static type checking and the full behavior test suite.

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
