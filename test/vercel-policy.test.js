import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  VERCEL_FUNCTION_MAX_DURATION_SECONDS,
  VERCEL_POLL_LOCK_TTL_SECONDS,
} from "../src/vercel-policy.js";

test("the GitHub scheduler and Vercel duration leave safe boundaries", () => {
  assert.ok(VERCEL_FUNCTION_MAX_DURATION_SECONDS < VERCEL_POLL_LOCK_TTL_SECONDS);

  const vercelConfig = JSON.parse(
    readFileSync(new URL("../vercel.json", import.meta.url), "utf8"),
  );
  assert.equal(
    vercelConfig.functions["api/cron.js"].maxDuration,
    VERCEL_FUNCTION_MAX_DURATION_SECONDS,
  );
  assert.equal(vercelConfig.crons, undefined);

  const workflow = readFileSync(
    new URL("../.github/workflows/trigger-vercel-cron.yml", import.meta.url),
    "utf8",
  );
  const scheduleMatch = workflow.match(/cron: "([^"]+)"/);
  assert.ok(scheduleMatch);
  const schedule = scheduleMatch[1];
  assert.equal(schedule, "2-59/5 * * * *");
  const [minuteSchedule] = schedule.split(" ");
  const [, intervalMinutes] = minuteSchedule.split("/");
  const scheduleIntervalSeconds = Number(intervalMinutes) * 60;
  assert.ok(VERCEL_POLL_LOCK_TTL_SECONDS < scheduleIntervalSeconds);

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /CRON_SECRET: \$\{\{ secrets\.CRON_SECRET \}\}/);
  assert.match(workflow, /Authorization: Bearer \$\{CRON_SECRET\}/);
  assert.match(workflow, /https:\/\/o1exchangetelegrmabot\.vercel\.app\/api\/cron/);
});
