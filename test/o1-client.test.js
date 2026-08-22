import assert from "node:assert/strict";
import test from "node:test";

import { O1Client } from "../src/o1-client.js";

test("listTokens requests the newest 100 tokens for a chain", async () => {
  /** @type {{ input: string, init: RequestInit | undefined }[]} */
  const requests = [];
  const expectedToken = {
    chain_id: 8453,
    token: { address: "0x1234", name: "Example", symbol: "EX" },
    launch: {
      created_at: "2026-08-22T10:00:00.000Z",
      pool_id: "0xpool",
      creator_address: "0xcreator",
    },
    market_data: {},
  };

  const client = new O1Client({
    apiKey: "test-api-key",
    fetchImpl: async (input, init) => {
      requests.push({ input: String(input), init });
      return new Response(JSON.stringify({ data: [expectedToken] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const tokens = await client.listTokens(8453);

  assert.deepEqual(tokens, [expectedToken]);
  assert.equal(requests.length, 1);
  const request = requests[0];
  const url = new URL(request.input);
  assert.equal(url.origin, "https://api.launch.o1.exchange");
  assert.equal(url.pathname, "/v1/tokens");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    chain_id: "8453",
    market: "all",
    sort: "newest",
    limit: "100",
  });
  assert.equal(new Headers(request.init?.headers).get("x-api-key"), "test-api-key");
});
