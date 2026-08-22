/** @typedef {import("./types.js").O1Token} O1Token */

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

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await this.#fetch(url, {
        headers: {
          accept: "application/json",
          "x-api-key": this.#apiKey,
        },
      });

      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < 2) {
          await delay(retryDelayMs(response.headers.get("retry-after"), attempt));
          continue;
        }
        throw new Error(`o1 API request failed with status ${response.status}`);
      }

      const payload = /** @type {{ data?: O1Token[] }} */ (await response.json());
      if (!Array.isArray(payload.data)) {
        throw new Error("o1 API response did not contain a token list");
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
      return Math.min(seconds * 1_000, 5_000);
    }

    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) {
      return Math.min(Math.max(0, retryAt - Date.now()), 5_000);
    }
  }

  return Math.min(1_000 * 2 ** attempt, 5_000);
}

/** @param {number} milliseconds */
function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
