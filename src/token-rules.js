/** @typedef {import("./types.js").O1Token} O1Token */
/** @typedef {import("./types.js").AlertRules} AlertRules */

/**
 * @param {O1Token} token
 * @param {AlertRules} rules
 * @param {Date} [now]
 */
export function matchesAlertRules(token, rules, now = new Date()) {
  const createdAt = Date.parse(token.launch.created_at);
  const ageHours = (now.getTime() - createdAt) / 3_600_000;
  const marketCapUsd = token.market_data?.market_cap?.usd;
  const twentyFourHourVolumeUsd = token.market_data?.activity?.["24h"]?.volume_usd;

  return (
    Number.isFinite(createdAt) &&
    ageHours >= 0 &&
    ageHours < rules.maximumAgeHours &&
    token.market_data?.data_status === "fresh" &&
    ((typeof marketCapUsd === "number" &&
      Number.isFinite(marketCapUsd) &&
      marketCapUsd >= rules.minimumMarketCapUsd) ||
      (typeof twentyFourHourVolumeUsd === "number" &&
        Number.isFinite(twentyFourHourVolumeUsd) &&
        twentyFourHourVolumeUsd >= rules.minimum24HourVolumeUsd))
  );
}
