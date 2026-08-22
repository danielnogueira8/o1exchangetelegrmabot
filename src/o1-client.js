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
