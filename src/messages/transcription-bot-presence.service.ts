import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '@randan/tg-logger';
import { InjectBot } from 'nestjs-telegraf';
import type { Telegraf } from 'telegraf';

import { MessageRepository } from './message.repository';

const PRESENCE_CACHE_TTL_MS = 5 * 60 * 1000;

interface PresenceCacheEntry {
  present: boolean;
  expiresAt: number;
}

@Injectable()
export class TranscriptionBotPresenceService {
  private readonly presenceCache = new Map<number, PresenceCacheEntry>();

  constructor(
    private readonly config: ConfigService,
    @InjectBot() private readonly bot: Telegraf,
    private readonly messageRepository: MessageRepository,
    private readonly logger: LoggerService,
  ) {}

  markPresent(chatId: number): void {
    this.cachePresence(chatId, true);
  }

  async isTranscriptionBotPresent(chatId: number): Promise<boolean> {
    const cached = this.presenceCache.get(chatId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.present;
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
        this.cachePresence(chatId, isPresent);
        return isPresent;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        this.logger.log('Could not resolve transcription bot via getChatMember', { chatId, errorMessage });
        this.cachePresence(chatId, false);
        return false;
      }
    }

    const hasMessages = await this.messageRepository.hasTranscriptionBotMessages(chatId, username);
    this.cachePresence(chatId, hasMessages);
    return hasMessages;
  }

  private cachePresence(chatId: number, present: boolean): void {
    this.presenceCache.set(chatId, {
      present,
      expiresAt: Date.now() + PRESENCE_CACHE_TTL_MS,
    });
  }
}
