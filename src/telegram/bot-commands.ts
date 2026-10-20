import type { BotCommand } from '@randan/tg-bot-kit';

/** The public commands, in menu order; the kit writes them to Telegram on startup. */
export const BOT_COMMANDS: BotCommand[] = [
  { command: 'summary', description: 'Підсумок останніх N повідомлень' },
  { command: 'summary_m', description: 'Підсумок за останні N хвилин' },
  { command: 'summary_h', description: 'Підсумок за останні N годин' },
  { command: 'summary_d', description: 'Підсумок за останні N днів' },
  { command: 'help', description: 'Допомога та список команд' },
  { command: 'start', description: 'Як користуватись ботом' },
];
