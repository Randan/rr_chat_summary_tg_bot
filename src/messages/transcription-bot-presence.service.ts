import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '@randan/tg-logger';
import { InjectBot } from 'nestjs-telegraf';
import type { Telegraf } from 'telegraf';

import { MessageRepository } from './message.repository';

@Injectable()
export class TranscriptionBotPresenceService {
  private readonly presenceCache = new Map<number, boolean>();

  constructor(
    private readonly config: ConfigService,
    @InjectBot() private readonly bot: Telegraf,
    private readonly messageRepository: MessageRepository,
    private readonly logger: LoggerService,
  ) {}

  markPresent(chatId: number): void {
    this.presenceCache.set(chatId, true);
  }

  async isTranscriptionBotPresent(chatId: number): Promise<boolean> {
    if (this.presenceCache.get(chatId) === true) {
      return true;
    }

    const username = this.config.get<string>('TRANSCRIPTION_BOT_USERNAME');
    if (!username) {
      return false;
    }

    const userId = this.config.get<number>('TRANSCRIPTION_BOT_USER_ID');
    if (userId) {
      try {
        const member = await this.bot.telegram.getChatMember(chatId, userId);
        const isPresent = member.status !== 'left' && member.status !== 'kicked';
        if (isPresent) {
          this.presenceCache.set(chatId, true);
        }
        return isPresent;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        this.logger.log('Could not resolve transcription bot via getChatMember', { chatId, errorMessage });
      }
    }

    const hasMessages = await this.messageRepository.hasTranscriptionBotMessages(chatId, username);
    if (hasMessages) {
      this.presenceCache.set(chatId, true);
    }
    return hasMessages;
  }
}
