/** @typedef {import("./types.js").O1Token} O1Token */

export class O1Client {
  /** @type {string} */
  #apiKey;

  /** @type {string} */
  #baseUrl;

  /** @type {string} */
  #market;

  /** @type {number} */
  #limit;

  /** @type {typeof fetch} */
  #fetch;

  /**
   * @param {{
   *   apiKey: string,
   *   baseUrl?: string,
   *   market?: string,
   *   limit?: number,
   *   fetchImpl?: typeof fetch
   * }} options
   */
  constructor({
    apiKey,
    baseUrl = "https://api.launch.o1.exchange",
    market = "all",
    limit = 100,
    fetchImpl = fetch,
  }) {
    this.#apiKey = apiKey;
    this.#baseUrl = baseUrl;
    this.#market = market;
    this.#limit = limit;
    this.#fetch = fetchImpl;
  }

  /** @param {number} chainId */
  async listTokens(chainId) {
    const url = new URL("/v1/tokens", this.#baseUrl);
    url.searchParams.set("chain_id", String(chainId));
    url.searchParams.set("market", this.#market);
    url.searchParams.set("sort", "newest");
    url.searchParams.set("limit", String(this.#limit));

    const response = await this.#fetch(url, {
      headers: {
        accept: "application/json",
        "x-api-key": this.#apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`o1 API request failed with status ${response.status}`);
    }

    const payload = /** @type {{ data?: O1Token[] }} */ (await response.json());
    if (!Array.isArray(payload.data)) {
      throw new Error("o1 API response did not contain a token list");
    }

    return payload.data;
  }
}
