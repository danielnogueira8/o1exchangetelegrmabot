/** @typedef {import("./types.js").O1Token} O1Token */

/**
 * @typedef {{
 *   address: string,
 *   name: string,
 *   symbol: string,
 *   decimals: number,
 *   blockNumber: string,
 *   transactionHash: string,
 *   blockTimestamp?: string
 * }} DecodedB20Launch
 */

/**
 * @typedef {{
 *   pairAddress: string,
 *   baseToken: { address: string, name: string, symbol: string },
 *   priceUsd?: string,
 *   marketCap?: number,
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
const DEFAULT_MINIMUM_MARKET_CAP_USD = 100_000;
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ROLE_GRANTED_TOPIC =
  "0x2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d";
const ZERO_WORD = `0x${"0".repeat(64)}`;
const BLOCKSCOUT_BASE_API_URL = "https://base.blockscout.com/api";
const BLOCKSCOUT_TIMEOUT_MILLISECONDS = 4_000;

export class B20Client {
  /** @type {string} */
  #rpcUrl;

  /** @type {typeof fetch} */
  #fetch;

  /** @type {number} */
  #minimumMarketCapUsd;

  /** @type {number} */
  #requestId = 0;

  /** @type {Map<string, Promise<string>>} */
  #blockTimestamps = new Map();

  /** @param {{ rpcUrl?: string, fetchImpl?: typeof fetch, minimumMarketCapUsd?: number }} [options] */
  constructor({
    rpcUrl = BASE_RPC_URL,
    fetchImpl = fetch,
    minimumMarketCapUsd = DEFAULT_MINIMUM_MARKET_CAP_USD,
  } = {}) {
    if (!Number.isFinite(minimumMarketCapUsd) || minimumMarketCapUsd < 0) {
      throw new Error("B20 minimum market cap must be a non-negative number");
    }
    this.#rpcUrl = rpcUrl;
    this.#fetch = fetchImpl;
    this.#minimumMarketCapUsd = minimumMarketCapUsd;
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
    /** @type {{ launch: DecodedB20Launch, token: O1Token }[]} */
    const candidates = [];
    for (const launch of launches) {
      const token = tokenFromLaunch(
        launch,
        pairs.get(launch.address.toLowerCase()),
        this.#minimumMarketCapUsd,
      );
      if (token !== undefined) {
        candidates.push({ launch, token });
      }
    }

    return Promise.all(
      candidates.map(async ({ launch, token }) => {
        try {
          return await this.#withLaunchAlpha(token, launch);
        } catch {
          return token;
        }
      }),
    );
  }

  /** @param {O1Token} token @param {DecodedB20Launch} launch */
  async #withLaunchAlpha(token, launch) {
    const transaction = await this.#rpc("eth_getTransactionByHash", [launch.transactionHash]);
    if (
      transaction === null ||
      typeof transaction !== "object" ||
      !("from" in transaction) ||
      typeof transaction.from !== "string"
    ) {
      return token;
    }

    const caller = transaction.from;
    const previousBlock = previousBlockTag(launch.blockNumber);
    const [codeResult, balanceResult, receiptResult, firstActivityResult] = await Promise.allSettled([
      this.#rpc("eth_getCode", [caller, launch.blockNumber]),
      this.#rpc("eth_getBalance", [caller, previousBlock]),
      this.#rpc("eth_getTransactionReceipt", [launch.transactionHash]),
      this.#baseWalletFirstActivity(caller),
    ]);

    const alpha = {
      factory_caller: caller,
      ...(codeResult.status === "fulfilled" && typeof codeResult.value === "string"
        ? {
            factory_caller_type:
              codeResult.value === "0x"
                ? /** @type {const} */ ("EOA")
                : /** @type {const} */ ("contract"),
          }
        : {}),
      ...(balanceResult.status === "fulfilled" && typeof balanceResult.value === "string"
        ? { prelaunch_eth: formatWeiAsEth(balanceResult.value) }
        : {}),
      ...(firstActivityResult.status === "fulfilled" && firstActivityResult.value !== undefined
        ? { base_wallet_first_activity_at: firstActivityResult.value }
        : {}),
      ...(receiptResult.status === "fulfilled"
        ? launchReceiptAlpha(receiptResult.value, token.token.address)
        : {}),
    };
    return { ...token, launch: { ...token.launch, alpha } };
  }

  /** @param {string} address */
  async #baseWalletFirstActivity(address) {
    const url = new URL(BLOCKSCOUT_BASE_API_URL);
    url.search = new URLSearchParams({
      module: "account",
      action: "txlist",
      address,
      page: "1",
      offset: "1",
      sort: "asc",
    }).toString();
    const response = await this.#fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(BLOCKSCOUT_TIMEOUT_MILLISECONDS),
    });
    if (!response.ok) {
      throw new Error(`Blockscout request failed with status ${response.status}`);
    }
    const payload = /** @type {unknown} */ (await response.json());
    if (
      payload === null ||
      typeof payload !== "object" ||
      !("result" in payload) ||
      !Array.isArray(payload.result) ||
      payload.result.length === 0
    ) {
      return undefined;
    }
    const firstTransaction = payload.result[0];
    if (
      firstTransaction === null ||
      typeof firstTransaction !== "object" ||
      !("timeStamp" in firstTransaction) ||
      typeof firstTransaction.timeStamp !== "string"
    ) {
      return undefined;
    }
    const firstActivityAt = new Date(Number(BigInt(firstTransaction.timeStamp)) * 1_000).toISOString();
    return Number.isFinite(Date.parse(firstActivityAt)) ? firstActivityAt : undefined;
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
    !("transactionHash" in log) ||
    typeof log.transactionHash !== "string" ||
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
      transactionHash: log.transactionHash,
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
 * @param {number} minimumMarketCapUsd
 * @returns {O1Token | undefined}
 */
function tokenFromLaunch(launch, pairs, minimumMarketCapUsd) {
  const bestPair = pairs
    ?.filter(isDexPair)
    .sort((left, right) => (right.liquidity?.usd ?? 0) - (left.liquidity?.usd ?? 0))[0];
  if (bestPair === undefined) {
    return undefined;
  }
  const marketCapUsd = numberValue(bestPair.marketCap);
  if (marketCapUsd === undefined || marketCapUsd < minimumMarketCapUsd) {
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
      market_cap: { usd: marketCapUsd },
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
  const parsed = numberValue(value);
  return parsed === undefined ? undefined : { usd: parsed };
}

/** @param {unknown} value */
function numberValue(value) {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : undefined;
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

/** @param {string} blockNumber */
function previousBlockTag(blockNumber) {
  const number = Number(BigInt(blockNumber));
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error("Base RPC returned an invalid B20 creation block number");
  }
  return toBlockTag(Math.max(0, number - 1));
}

/** @param {string} value */
function formatWeiAsEth(value) {
  const wei = BigInt(value);
  if (wei < 0n) {
    throw new Error("Base RPC returned a negative ETH balance");
  }
  const whole = wei / 1_000_000_000_000_000_000n;
  const fraction = (wei % 1_000_000_000_000_000_000n)
    .toString()
    .padStart(18, "0")
    .slice(0, 4)
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/** @param {unknown} receipt @param {string} tokenAddress */
function launchReceiptAlpha(receipt, tokenAddress) {
  if (receipt === null || typeof receipt !== "object" || !("logs" in receipt) || !Array.isArray(receipt.logs)) {
    return {};
  }

  /** @type {Map<string, bigint>} */
  const mintedByRecipient = new Map();
  let adminRoleGranted = false;
  for (const log of receipt.logs) {
    if (log === null || typeof log !== "object" || !("topics" in log) || !Array.isArray(log.topics)) {
      continue;
    }
    const topics = log.topics;
    if (
      "address" in log &&
      typeof log.address === "string" &&
      log.address.toLowerCase() === tokenAddress.toLowerCase() &&
      topics[0] === TRANSFER_TOPIC &&
      topics[1] === ZERO_WORD &&
      typeof topics[2] === "string" &&
      "data" in log &&
      typeof log.data === "string"
    ) {
      try {
        const recipient = `0x${topics[2].slice(-40)}`.toLowerCase();
        mintedByRecipient.set(recipient, (mintedByRecipient.get(recipient) ?? 0n) + BigInt(log.data));
      } catch {
        // A malformed receipt log should not discard the rest of the launch alpha.
      }
    }
    if (
      "address" in log &&
      typeof log.address === "string" &&
      log.address.toLowerCase() === tokenAddress.toLowerCase() &&
      topics[0] === ROLE_GRANTED_TOPIC &&
      topics[1] === ZERO_WORD
    ) {
      adminRoleGranted = true;
    }
  }

  const totalMinted = [...mintedByRecipient.values()].reduce((total, amount) => total + amount, 0n);
  const largestMint = [...mintedByRecipient.values()].reduce(
    (largest, amount) => (amount > largest ? amount : largest),
    0n,
  );
  return {
    ...(receipt.logs.length > 0 ? { admin_role_granted: adminRoleGranted } : {}),
    ...(mintedByRecipient.size > 0
      ? {
          initial_mint_recipients: mintedByRecipient.size,
          largest_initial_mint_share_percent:
            Number((largestMint * 10_000n) / totalMinted) / 100,
        }
      : {}),
  };
}

/** @template T @param {T[]} values @param {number} size */
function chunk(values, size) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size),
  );
}
