import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '@randan/tg-logger';
import { Ctx, On, Update } from 'nestjs-telegraf';
import type { Context } from 'telegraf';
import type { Message } from 'telegraf/types';

import { MessageIngestService } from './message-ingest.service';
import { TranscriptionBotPresenceService } from './transcription-bot-presence.service';

@Update()
@Injectable()
export class MessageIngestHandler {
  constructor(
    private readonly ingestService: MessageIngestService,
    private readonly config: ConfigService,
    private readonly presenceService: TranscriptionBotPresenceService,
    private readonly logger: LoggerService,
  ) {}

  @On('message')
  async onMessage(@Ctx() ctx: Context): Promise<void> {
    if (!ctx.message) {
      return;
    }

    try {
      await this.ingestService.ingest(ctx.message as Message);

      const chatId = ctx.chat?.id;
      const transcriptionBotUsername = this.config.get<string>('TRANSCRIPTION_BOT_USERNAME');
      const fromUsername = 'from' in ctx.message && ctx.message.from?.username ? ctx.message.from.username : undefined;

      if (chatId && transcriptionBotUsername && fromUsername === transcriptionBotUsername) {
        this.presenceService.markPresent(chatId);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error('Failed to ingest message', {
        chatId: ctx.chat?.id,
        messageId: ctx.message.message_id,
        errorMessage,
      });
    }
  }
}
