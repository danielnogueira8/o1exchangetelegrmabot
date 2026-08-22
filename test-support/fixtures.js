export const NOW = new Date("2026-08-22T12:00:00.000Z");

export const rules = {
  maximumAgeHours: 6,
  minimumMarketCapUsd: 100_000,
  minimumLiquidityUsd: 10_000,
  minimumOneHourTrades: 20,
};

export function qualifyingToken() {
  return {
    chain_id: 8453,
    token: {
      address: "0x1234",
      name: "Example Token",
      symbol: "EXAMPLE",
    },
    launch: {
      created_at: "2026-08-22T10:00:00.000Z",
      pool_id: "0xabcd",
      creator_address: "0xcreator",
    },
    market_data: {
      data_status: "fresh",
      market_cap: { usd: 150_000 },
      liquidity: { usd: 25_000 },
      activity: {
        "1h": { trades: 30, volume_usd: 12_000 },
        "6h": { trades: 80, volume_usd: 30_000 },
        "24h": { trades: 80, volume_usd: 30_000 },
      },
      price: { usd: 0.0015 },
    },
  };
}
