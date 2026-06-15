import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '@randan/tg-logger';

import { AI_PROVIDER } from '../ai/ai-provider.constants';
import type { AiProvider } from '../ai/ai-provider.interface';
import { MessageRepository } from '../messages/message.repository';
import { TranscriptionResolverService } from '../transcription/transcription-resolver.service';
import type { SummaryFilter } from './summary.types';
import { SummaryLimitsService } from './summary-limits.service';

export interface SummaryResult {
  text: string;
  requestedCount: number;
  analyzedCount: number;
  skippedVoiceCount: number;
}

@Injectable()
export class SummaryService {
  constructor(
    private readonly config: ConfigService,
    private readonly messageRepository: MessageRepository,
    private readonly transcriptionResolver: TranscriptionResolverService,
    private readonly limitsService: SummaryLimitsService,
    @Inject(AI_PROVIDER) private readonly aiProvider: AiProvider,
    private readonly logger: LoggerService,
  ) {}

  async buildSummary(chatId: number, filter: SummaryFilter): Promise<SummaryResult> {
    const messages = await this.fetchMessages(chatId, filter);

    if (messages.length === 0) {
      return {
        text: 'Немає повідомлень для аналізу в обраному періоді.',
        requestedCount: 0,
        analyzedCount: 0,
        skippedVoiceCount: 0,
      };
    }

    const periodLabel = this.buildPeriodLabel(filter);
    const withTranscriptions = await this.transcriptionResolver.resolveTranscriptions(messages);
    const limited = this.limitsService.apply(withTranscriptions, filter, periodLabel);

    const analyzedInfo =
      limited.analyzedCount < limited.requestedCount
        ? `Проаналізовано ${limited.analyzedCount} з ${limited.requestedCount} повідомлень (старіші було обрізано через ліміти).`
        : `Проаналізовано ${limited.analyzedCount} повідомлень.`;

    if (!limited.dialogText.trim()) {
      const skippedNote = this.buildSkippedVoiceNote(limited.skippedVoiceCount);
      return {
        text: `Не знайдено текстового вмісту для підсумку у обраному періоді.${skippedNote}`,
        requestedCount: limited.requestedCount,
        analyzedCount: limited.analyzedCount,
        skippedVoiceCount: limited.skippedVoiceCount,
      };
    }

    this.logger.log('Generating summary', {
      chatId,
      requestedCount: limited.requestedCount,
      analyzedCount: limited.analyzedCount,
      dialogLength: limited.dialogText.length,
    });

    const summaryText = await this.aiProvider.generateSummary({
      dialogue: limited.dialogText,
      periodLabel,
      analyzedInfo,
    });

    const skippedNote = this.buildSkippedVoiceNote(limited.skippedVoiceCount);

    return {
      text: `${summaryText}${skippedNote}`,
      requestedCount: limited.requestedCount,
      analyzedCount: limited.analyzedCount,
      skippedVoiceCount: limited.skippedVoiceCount,
    };
  }

  private async fetchMessages(chatId: number, filter: SummaryFilter) {
    switch (filter.type) {
      case 'count':
        return this.messageRepository.findLatestByCount(chatId, filter.value);
      case 'minutes':
        return this.messageRepository.findSince(chatId, new Date(Date.now() - filter.value * 60 * 1000));
      case 'hours':
        return this.messageRepository.findSince(chatId, new Date(Date.now() - filter.value * 60 * 60 * 1000));
      case 'days':
        return this.messageRepository.findSince(chatId, new Date(Date.now() - filter.value * 24 * 60 * 60 * 1000));
      default:
        return [];
    }
  }

  private buildPeriodLabel(filter: SummaryFilter): string {
    switch (filter.type) {
      case 'count':
        return `останні ${filter.value} повідомлень`;
      case 'minutes':
        return `останні ${filter.value} хвилин`;
      case 'hours':
        return `останні ${filter.value} годин`;
      case 'days':
        return `останні ${filter.value} днів`;
      default:
        return 'обраний період';
    }
  }

  private buildSkippedVoiceNote(skippedVoiceCount: number): string {
    if (skippedVoiceCount <= 0) {
      return '';
    }

    return `\n\n⚠️ ${skippedVoiceCount} голосових повідомлень без транскрипції не включено в підсумок.`;
  }
}
