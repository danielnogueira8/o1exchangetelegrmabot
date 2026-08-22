import { ConsoleNotifier, TelegramNotifier } from "./telegram.js";

/**
 * @param {ReturnType<typeof import("./config.js").loadConfig>} config
 * @param {{ info(...values: unknown[]): void }} [logger]
 */
export function createNotifier(config, logger = console) {
  if (config.dryRun) {
    return new ConsoleNotifier({ logger });
  }
  return new TelegramNotifier({
    botToken: /** @type {string} */ (config.telegramBotToken),
    chatId: /** @type {string} */ (config.telegramChatId),
  });
}
