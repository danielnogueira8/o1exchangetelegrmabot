/** @typedef {import("./types.js").O1Token} O1Token */

const MAX_REQUEST_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 5_000;

export class O1Client {
  /** @type {string} */
  #apiKey;

  /** @type {string} */
  #market;

  /** @type {typeof fetch} */
  #fetch;

  /**
   * @param {{
   *   apiKey: string,
   *   market?: string,
   *   fetchImpl?: typeof fetch
   * }} options
   */
  constructor({
    apiKey,
    market = "all",
    fetchImpl = fetch,
  }) {
    this.#apiKey = apiKey;
    this.#market = market;
    this.#fetch = fetchImpl;
  }

  /** @param {number} chainId */
  async listTokens(chainId) {
    const url = new URL("https://api.launch.o1.exchange/v1/tokens");
    url.searchParams.set("chain_id", String(chainId));
    url.searchParams.set("market", this.#market);
    url.searchParams.set("sort", "newest");
    url.searchParams.set("limit", "100");

    const data = await this.#requestData(url);
    if (!Array.isArray(data)) {
      throw new Error("o1 API response did not contain a token list");
    }
    return /** @type {O1Token[]} */ (data);
  }

  /**
   * @param {number} chainId
   * @param {string} tokenAddress
   */
  async getTokenDetails(chainId, tokenAddress) {
    const url = new URL(
      `https://api.launch.o1.exchange/v1/tokens/${chainId}/${encodeURIComponent(tokenAddress)}`,
    );
    url.searchParams.set("include", "market");

    const data = await this.#requestData(url);
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("o1 API response did not contain token details");
    }
    return /** @type {O1Token} */ (data);
  }

  /** @param {URL} url */
  async #requestData(url) {
    for (let attempt = 0; attempt < MAX_REQUEST_ATTEMPTS; attempt += 1) {
      const response = await this.#fetch(url, {
        headers: {
          accept: "application/json",
          "x-api-key": this.#apiKey,
        },
      });

      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < MAX_REQUEST_ATTEMPTS - 1) {
          await delay(retryDelayMs(response.headers.get("retry-after"), attempt));
          continue;
        }
        throw new Error(`o1 API request failed with status ${response.status}`);
      }

      const payload = /** @type {unknown} */ (await response.json());
      if (payload === null || typeof payload !== "object" || !("data" in payload)) {
        throw new Error("o1 API response did not contain data");
      }

      return payload.data;
    }

    throw new Error("o1 API request exhausted its retries");
  }
}

/**
 * @param {string | null} retryAfter
 * @param {number} attempt
 */
function retryDelayMs(retryAfter, attempt) {
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1_000, MAX_RETRY_DELAY_MS);
    }

    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) {
      return Math.min(Math.max(0, retryAt - Date.now()), MAX_RETRY_DELAY_MS);
    }
  }

  return Math.min(BASE_RETRY_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS);
}

/** @param {number} milliseconds */
function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
