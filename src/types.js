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
 *     image_url?: string,
 *     description?: string,
 *     website?: string,
 *     x?: string,
 *     telegram?: string
 *   },
 *   launch: {
 *     created_at: string,
 *     pool_id: string,
 *     creator_address?: string,
 *     source?: string,
 *     alpha?: {
 *       factory_caller?: string,
 *       factory_caller_type?: "EOA" | "contract",
 *       prelaunch_eth?: string,
 *       base_wallet_first_activity_at?: string,
 *       initial_mint_recipients?: number,
 *       largest_initial_mint_share_percent?: number,
 *       admin_role_granted?: boolean
 *     }
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
 *   listTokens: (chainId: number) => Promise<O1Token[]>,
 *   getTokenDetails?: (
 *     chainId: number,
 *     tokenAddress: string,
 *     options?: { signal?: AbortSignal }
 *   ) => Promise<O1Token>
 * }} O1ClientLike
 *
 * @typedef {{
 *   maximumAgeHours: number,
 *   minimumMarketCapUsd: number,
 *   minimum24HourVolumeUsd: number
 * }} AlertRules
 *
 * @typedef {"delivered" | "previewed"} DeliveryResult
 */

export {};
