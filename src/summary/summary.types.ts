import type { ChatMessageRecord } from '../messages/chat-message.types';

export type SummaryFilterType = 'count' | 'minutes' | 'hours' | 'days';

export interface SummaryFilter {
  type: SummaryFilterType;
  value: number;
}

export interface SummaryLimitsResult {
  messages: ChatMessageRecord[];
  requestedCount: number;
  analyzedCount: number;
  dialogText: string;
  periodLabel: string;
  skippedVoiceCount: number;
}
