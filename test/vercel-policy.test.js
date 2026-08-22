import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  VERCEL_CRON_INTERVAL_SECONDS,
  VERCEL_FUNCTION_MAX_DURATION_SECONDS,
  VERCEL_POLL_LOCK_TTL_SECONDS,
} from "../src/vercel-policy.js";

test("the Vercel timeout, lock TTL, and cron cadence leave safe boundaries", () => {
  assert.ok(VERCEL_FUNCTION_MAX_DURATION_SECONDS < VERCEL_POLL_LOCK_TTL_SECONDS);
  assert.ok(VERCEL_POLL_LOCK_TTL_SECONDS < VERCEL_CRON_INTERVAL_SECONDS);

  const vercelConfig = JSON.parse(
    readFileSync(new URL("../vercel.json", import.meta.url), "utf8"),
  );
  assert.equal(
    vercelConfig.functions["api/cron.js"].maxDuration,
    VERCEL_FUNCTION_MAX_DURATION_SECONDS,
  );
  assert.equal(vercelConfig.crons[0].schedule, "* * * * *");
  assert.equal(VERCEL_CRON_INTERVAL_SECONDS, 60);
});
