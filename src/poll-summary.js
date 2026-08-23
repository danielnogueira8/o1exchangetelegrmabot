/**
 * @param {{ fetched: number, qualified: number, sent: number, alreadyClaimed: number, errors: number }} left
 * @param {{ fetched: number, qualified: number, sent: number, alreadyClaimed: number, errors: number }} right
 */
export function addPollSummaries(left, right) {
  return {
    fetched: left.fetched + right.fetched,
    qualified: left.qualified + right.qualified,
    sent: left.sent + right.sent,
    alreadyClaimed: left.alreadyClaimed + right.alreadyClaimed,
    errors: left.errors + right.errors,
  };
}
