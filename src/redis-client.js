/**
 * @typedef {{
 *   set(
 *     key: string,
 *     value: string,
 *     options?: { nx?: true, ex?: number }
 *   ): Promise<unknown>,
 *   del(key: string): Promise<number>,
 *   eval(script: string, keys: string[], args: string[]): Promise<unknown>
 * }} RedisClient
 */

export {};
