/** @typedef {import("./types.js").O1Token} O1Token */

/**
 * @typedef {{
 *   address: string,
 *   name: string,
 *   symbol: string,
 *   decimals: number,
 *   blockNumber: string,
 *   blockTimestamp?: string
 * }} DecodedB20Launch
 */

/**
 * @typedef {{
 *   pairAddress: string,
 *   baseToken: { address: string, name: string, symbol: string },
 *   priceUsd?: string,
 *   marketCap?: number,
 *   fdv?: number,
 *   liquidity?: { usd?: number },
 *   volume?: { h1?: number, h6?: number, h24?: number },
 *   txns?: {
 *     h1?: { buys: number, sells: number },
 *     h6?: { buys: number, sells: number },
 *     h24?: { buys: number, sells: number }
 *   },
 *   info?: { imageUrl?: string }
 * }} DexPair
 */

const BASE_CHAIN_ID = 8453;
const BASE_RPC_URL = "https://mainnet.base.org";
const B20_FACTORY_ADDRESS = "0xB20f000000000000000000000000000000000000";
const B20_CREATED_TOPIC =
  // keccak256("B20Created(address,uint8,string,string,uint8,bytes)") from IB20Factory.
  "0xfd9bf2730513a1709722ff379a0844dfd8f997d600693c2bcc659e188bbdba0d";
const B20_LOOKBACK_BLOCKS = 3_600;
const DEXSCREENER_BATCH_SIZE = 30;

export class B20Client {
  /** @type {string} */
  #rpcUrl;

  /** @type {typeof fetch} */
  #fetch;

  /** @type {number} */
  #requestId = 0;

  /** @type {Map<string, Promise<string>>} */
  #blockTimestamps = new Map();

  /** @param {{ rpcUrl?: string, fetchImpl?: typeof fetch }} [options] */
  constructor({ rpcUrl = BASE_RPC_URL, fetchImpl = fetch } = {}) {
    this.#rpcUrl = rpcUrl;
    this.#fetch = fetchImpl;
  }

  /** @param {number} chainId */
  async listTokens(chainId) {
    if (chainId !== BASE_CHAIN_ID) {
      return [];
    }

    const latestBlock = Number(await this.#rpc("eth_blockNumber", []));
    if (!Number.isSafeInteger(latestBlock)) {
      throw new Error("Base RPC returned an invalid latest block number");
    }

    const logs = await this.#rpc("eth_getLogs", [
      {
        address: B20_FACTORY_ADDRESS,
        topics: [B20_CREATED_TOPIC],
        fromBlock: toBlockTag(Math.max(0, latestBlock - B20_LOOKBACK_BLOCKS)),
        toBlock: "latest",
      },
    ]);
    if (!Array.isArray(logs)) {
      throw new Error("Base RPC did not return B20 creation logs");
    }

    const decodedLaunches = logs
      .map(decodeB20CreatedLog)
      .filter((launch) => launch !== undefined);
    const launches = await Promise.all(
      decodedLaunches.map(async (launch) => ({
        ...launch,
        createdAt: await this.#createdAt(launch),
      })),
    );
    if (launches.length === 0) {
      return [];
    }

    const pairs = await this.#listPairs(launches.map((launch) => launch.address));
    return launches
      .map((launch) => tokenFromLaunch(launch, pairs.get(launch.address.toLowerCase())))
      .filter((token) => token !== undefined);
  }

  /** @param {DecodedB20Launch} launch */
  async #createdAt(launch) {
    const timestamp =
      launch.blockTimestamp ?? (await this.#blockTimestamp(launch.blockNumber));
    const createdAt = new Date(Number(BigInt(timestamp)) * 1_000).toISOString();
    if (!Number.isFinite(Date.parse(createdAt))) {
      throw new Error("Base RPC returned an invalid B20 creation timestamp");
    }
    return createdAt;
  }

  /** @param {string} blockNumber */
  #blockTimestamp(blockNumber) {
    let timestamp = this.#blockTimestamps.get(blockNumber);
    if (timestamp === undefined) {
      timestamp = this.#rpc("eth_getBlockByNumber", [blockNumber, false]).then((block) => {
        if (
          block === null ||
          typeof block !== "object" ||
          !("timestamp" in block) ||
          typeof block.timestamp !== "string"
        ) {
          throw new Error("Base RPC block response did not contain a timestamp");
        }
        return block.timestamp;
      });
      this.#blockTimestamps.set(blockNumber, timestamp);
    }
    return timestamp;
  }

  /** @param {string[]} addresses */
  async #listPairs(addresses) {
    const batches = chunk(addresses, DEXSCREENER_BATCH_SIZE);
    const responses = await Promise.all(
      batches.map(async (batch) => {
        const response = await this.#fetch(
          `https://api.dexscreener.com/tokens/v1/base/${batch.join(",")}`,
          { headers: { accept: "application/json" } },
        );
        if (!response.ok) {
          throw new Error(`DexScreener request failed with status ${response.status}`);
        }
        const payload = /** @type {unknown} */ (await response.json());
        if (!Array.isArray(payload)) {
          throw new Error("DexScreener response did not contain token pairs");
        }
        return payload;
      }),
    );

    /** @type {Map<string, DexPair[]>} */
    const pairs = new Map();
    for (const response of responses) {
      for (const pair of response) {
        if (
          pair !== null &&
          typeof pair === "object" &&
          "baseToken" in pair &&
          pair.baseToken !== null &&
          typeof pair.baseToken === "object" &&
          "address" in pair.baseToken &&
          typeof pair.baseToken.address === "string"
        ) {
          const address = pair.baseToken.address.toLowerCase();
          pairs.set(address, [...(pairs.get(address) ?? []), /** @type {DexPair} */ (pair)]);
        }
      }
    }
    return pairs;
  }

  /** @param {string} method @param {unknown[]} params */
  async #rpc(method, params) {
    const response = await this.#fetch(this.#rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++this.#requestId, method, params }),
    });
    if (!response.ok) {
      throw new Error(`Base RPC request failed with status ${response.status}`);
    }
    const payload = /** @type {unknown} */ (await response.json());
    if (payload === null || typeof payload !== "object" || !("result" in payload)) {
      throw new Error("Base RPC response did not contain a result");
    }
    if ("error" in payload && payload.error !== undefined) {
      throw new Error("Base RPC returned an error");
    }
    return payload.result;
  }
}

/** @param {unknown} log @returns {DecodedB20Launch | undefined} */
function decodeB20CreatedLog(log) {
  if (
    log === null ||
    typeof log !== "object" ||
    !("topics" in log) ||
    !("data" in log) ||
    !("blockNumber" in log) ||
    !Array.isArray(log.topics) ||
    typeof log.data !== "string" ||
    typeof log.blockNumber !== "string" ||
    log.topics.length < 3 ||
    typeof log.topics[1] !== "string"
  ) {
    return undefined;
  }

  try {
    const address = `0x${log.topics[1].slice(-40)}`;
    const data = log.data.startsWith("0x") ? log.data.slice(2) : "";
    const name = decodeDynamicString(data, readWord(data, 0));
    const symbol = decodeDynamicString(data, readWord(data, 1));
    const decimals = Number(BigInt(`0x${readWord(data, 2)}`));
    if (!name || !symbol || !Number.isSafeInteger(decimals)) {
      return undefined;
    }
    return {
      address,
      name,
      symbol,
      decimals,
      blockNumber: log.blockNumber,
      blockTimestamp:
        "blockTimestamp" in log && typeof log.blockTimestamp === "string"
          ? log.blockTimestamp
          : undefined,
    };
  } catch {
    return undefined;
  }
}

/** @param {string} data @param {string} offsetWord */
function decodeDynamicString(data, offsetWord) {
  const offset = Number(BigInt(`0x${offsetWord}`));
  const length = Number(BigInt(`0x${readWord(data, offset / 32)}`));
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0) {
    throw new Error("Invalid ABI string offset");
  }
  const start = (offset + 32) * 2;
  const end = start + length * 2;
  if (end > data.length) {
    throw new Error("ABI string exceeds event data");
  }
  return Buffer.from(data.slice(start, end), "hex").toString("utf8");
}

/** @param {string} data @param {number} index */
function readWord(data, index) {
  const start = index * 64;
  const word = data.slice(start, start + 64);
  if (!/^[0-9a-f]{64}$/i.test(word)) {
    throw new Error("Invalid ABI word");
  }
  return word;
}

/**
 * @param {{ address: string, name: string, symbol: string, decimals: number, createdAt: string }} launch
 * @param {DexPair[] | undefined} pairs
 * @returns {O1Token | undefined}
 */
function tokenFromLaunch(launch, pairs) {
  const bestPair = pairs
    ?.filter(isDexPair)
    .sort((left, right) => (right.liquidity?.usd ?? 0) - (left.liquidity?.usd ?? 0))[0];
  if (bestPair === undefined) {
    return undefined;
  }

  return {
    chain_id: BASE_CHAIN_ID,
    token: {
      address: launch.address,
      name: bestPair.baseToken.name || launch.name,
      symbol: bestPair.baseToken.symbol || launch.symbol,
      decimals: launch.decimals,
      image_url: bestPair.info?.imageUrl,
    },
    launch: {
      created_at: launch.createdAt,
      pool_id: bestPair.pairAddress,
      source: "Base B20 Factory",
    },
    market_data: {
      data_status: "fresh",
      price: numberMetric(bestPair.priceUsd),
      market_cap: numberMetric(bestPair.marketCap ?? bestPair.fdv),
      liquidity: numberMetric(bestPair.liquidity?.usd),
      activity: {
        "1h": activityMetric(bestPair.txns?.h1, bestPair.volume?.h1),
        "6h": activityMetric(bestPair.txns?.h6, bestPair.volume?.h6),
        "24h": activityMetric(bestPair.txns?.h24, bestPair.volume?.h24),
      },
    },
  };
}

/** @param {unknown} value */
function numberMetric(value) {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? { usd: parsed } : undefined;
}

/** @param {unknown} activity @param {unknown} volume */
function activityMetric(activity, volume) {
  const trades =
    activity !== null &&
    typeof activity === "object" &&
    "buys" in activity &&
    "sells" in activity &&
    typeof activity.buys === "number" &&
    typeof activity.sells === "number"
      ? activity.buys + activity.sells
      : undefined;
  const volumeUsd = typeof volume === "number" && Number.isFinite(volume) ? volume : undefined;
  return trades === undefined && volumeUsd === undefined ? undefined : { trades, volume_usd: volumeUsd };
}

/** @param {unknown} pair @returns {pair is DexPair} */
function isDexPair(pair) {
  return (
    pair !== null &&
    typeof pair === "object" &&
    "baseToken" in pair &&
    pair.baseToken !== null &&
    typeof pair.baseToken === "object" &&
    "name" in pair.baseToken &&
    "symbol" in pair.baseToken &&
    typeof pair.baseToken.name === "string" &&
    typeof pair.baseToken.symbol === "string" &&
    "pairAddress" in pair &&
    typeof pair.pairAddress === "string"
  );
}

/** @param {number} value */
function toBlockTag(value) {
  return `0x${value.toString(16)}`;
}

/** @template T @param {T[]} values @param {number} size */
function chunk(values, size) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size),
  );
}
