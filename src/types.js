/**
 * @typedef {{
 *   trades?: number,
 *   volume_usd?: number,
 *   volume_quote_raw?: string
 * }} TokenActivity
 *
 * @typedef {{
 *   chain_id: number,
 *   market?: string,
 *   token: {
 *     address: string,
 *     name: string,
 *     symbol: string,
 *     decimals?: number,
 *     image_url?: string
 *   },
 *   launch: {
 *     created_at: string,
 *     pool_id: string,
 *     creator_address: string
 *   },
 *   market_data?: {
 *     data_status?: string,
 *     price?: { usd?: number },
 *     market_cap?: { usd?: number },
 *     liquidity?: { usd?: number },
 *     activity?: {
 *       "1h"?: TokenActivity,
 *       "6h"?: TokenActivity,
 *       "24h"?: TokenActivity
 *     }
 *   }
 * }} O1Token
 *
 * @typedef {{
 *   maximumAgeHours: number,
 *   minimumMarketCapUsd: number,
 *   minimum24HourVolumeUsd: number
 * }} AlertRules
 */

export {};
