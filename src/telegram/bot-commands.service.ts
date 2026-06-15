import { Injectable, OnModuleInit } from '@nestjs/common';
import { LoggerService } from '@randan/tg-logger';
import { InjectBot } from 'nestjs-telegraf';
import type { Telegraf } from 'telegraf';

const BOT_COMMANDS = [
  { command: 'summary', description: 'Підсумок останніх N повідомлень' },
  { command: 'summary_m', description: 'Підсумок за останні N хвилин' },
  { command: 'summary_h', description: 'Підсумок за останні N годин' },
  { command: 'summary_d', description: 'Підсумок за останні N днів' },
] as const;

@Injectable()
export class BotCommandsService implements OnModuleInit {
  constructor(
    @InjectBot() private readonly bot: Telegraf,
    private readonly logger: LoggerService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.bot.telegram.setMyCommands([...BOT_COMMANDS]);
      this.logger.log('Telegram bot commands registered');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error('Failed to register Telegram bot commands', { errorMessage });
    }
  }
}
