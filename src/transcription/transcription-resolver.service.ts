import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '@randan/tg-logger';

import { mapWithConcurrency } from '../common/concurrency.util';
import type { ChatMessageRecord } from '../messages/chat-message.types';
import { MessageRepository } from '../messages/message.repository';
import { MessageType } from '../messages/message-type.enum';
import { TranscriptionBotPresenceService } from '../messages/transcription-bot-presence.service';
import { TranscriptionClientService } from './transcription-client.service';
import { parseTranscriptionBotText } from './transcription-parser.util';

const DEFAULT_TRANSCRIPTION_CONCURRENCY = 3;

@Injectable()
export class TranscriptionResolverService {
  constructor(
    private readonly config: ConfigService,
    private readonly messageRepository: MessageRepository,
    private readonly transcriptionClient: TranscriptionClientService,
    private readonly presenceService: TranscriptionBotPresenceService,
    private readonly logger: LoggerService,
  ) {}

  async resolveTranscriptions(messages: ChatMessageRecord[]): Promise<ChatMessageRecord[]> {
    const chatId = messages[0]?.chatId;
    if (!chatId) {
      return [];
    }

    const transcriptionBotPresent = await this.presenceService.isTranscriptionBotPresent(chatId);
    const transcriptionBotUsername = this.config.get<string>('TRANSCRIPTION_BOT_USERNAME');
    const concurrency = this.config.get<number>('TRANSCRIPTION_CONCURRENCY', DEFAULT_TRANSCRIPTION_CONCURRENCY);

    const resolved = await mapWithConcurrency(messages, concurrency, async message => {
      if (message.type !== MessageType.Voice && message.type !== MessageType.VideoNote) {
        return message;
      }

      if (message.transcription) {
        return message;
      }

      const transcription = await this.resolveSingleMessage(message, transcriptionBotPresent, transcriptionBotUsername);

      if (transcription) {
        await this.messageRepository.saveTranscription(message.chatId, message.messageId, transcription);
        return { ...message, transcription };
      }

      return message;
    });

    return resolved;
  }

  private async resolveSingleMessage(
    message: ChatMessageRecord,
    transcriptionBotPresent: boolean,
    transcriptionBotUsername?: string,
  ): Promise<string | undefined> {
    if (transcriptionBotPresent && transcriptionBotUsername) {
      const replies = await this.messageRepository.findTranscriptionReplies(
        message.chatId,
        message.messageId,
        transcriptionBotUsername,
      );

      const parsedParts = replies
        .map(reply => (reply.text ? parseTranscriptionBotText(reply.text) : ''))
        .filter(Boolean);

      if (parsedParts.length > 0) {
        const parsed = parsedParts.join('\n\n');
        this.logger.log('Resolved transcription from Telegram bot', {
          chatId: message.chatId,
          messageId: message.messageId,
          chunks: parsedParts.length,
        });
        return parsed;
      }

      this.logger.log('Transcription bot present but reply not found, falling back to HTTP', {
        chatId: message.chatId,
        messageId: message.messageId,
      });
    }

    if (!message.telegramFileId) {
      return undefined;
    }

    const mimeType = typeof message.metadata?.mimeType === 'string' ? message.metadata.mimeType : undefined;
    const transcription = await this.transcriptionClient.transcribeTelegramFile(message.telegramFileId, mimeType);

    if (transcription) {
      this.logger.log('Resolved transcription via HTTP service', {
        chatId: message.chatId,
        messageId: message.messageId,
      });
    }

    return transcription || undefined;
  }
}
