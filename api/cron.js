import { Redis } from "@upstash/redis";

import { createCronHandler } from "../src/vercel-cron.js";

export const GET = createCronHandler({
  createRedis: () => Redis.fromEnv(),
});
