import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { ChatMessageRecord } from '../messages/chat-message.types';
import { MessageType } from '../messages/message-type.enum';
import type { SummaryFilter, SummaryLimitsResult } from './summary.types';

@Injectable()
export class SummaryLimitsService {
  constructor(private readonly config: ConfigService) {}

  apply(messages: ChatMessageRecord[], filter: SummaryFilter, periodLabel: string): SummaryLimitsResult {
    const maxMessages = this.config.get<number>('SUMMARY_MAX_MESSAGES', 500);
    const maxCharacters = this.config.get<number>('SUMMARY_MAX_CHARACTERS', 50000);

    const requestedCount = messages.length;
    let trimmed = [...messages];

    if (trimmed.length > maxMessages) {
      trimmed = trimmed.slice(trimmed.length - maxMessages);
    }

    let skippedVoiceCount = 0;
    let dialogText = this.buildDialog(trimmed, count => {
      skippedVoiceCount += count;
    });

    while (dialogText.length > maxCharacters && trimmed.length > 1) {
      trimmed = trimmed.slice(1);
      skippedVoiceCount = 0;
      dialogText = this.buildDialog(trimmed, count => {
        skippedVoiceCount += count;
      });
    }

    return {
      messages: trimmed,
      requestedCount,
      analyzedCount: trimmed.length,
      dialogText,
      periodLabel,
      skippedVoiceCount,
    };
  }

  private buildDialog(messages: ChatMessageRecord[], onSkippedVoice: (count: number) => void): string {
    return messages
      .map(message => {
        const content = this.resolveMessageContent(message, onSkippedVoice);
        if (!content) {
          return null;
        }
        return `${message.displayName}: ${content}`;
      })
      .filter((line): line is string => Boolean(line))
      .join('\n\n');
  }

  private resolveMessageContent(message: ChatMessageRecord, onSkippedVoice: (count: number) => void): string | null {
    if (message.type === MessageType.Voice || message.type === MessageType.VideoNote) {
      const transcription = message.transcription?.trim();
      if (!transcription) {
        onSkippedVoice(1);
        return null;
      }
      return transcription;
    }

    if (message.text?.trim()) {
      return message.text.trim();
    }

    if (message.type === MessageType.Photo) {
      return '[фото]';
    }

    if (message.type === MessageType.Document) {
      const fileName = typeof message.metadata?.fileName === 'string' ? message.metadata.fileName : 'документ';
      return `[документ: ${fileName}]`;
    }

    return null;
  }
}
