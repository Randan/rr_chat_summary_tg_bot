import type { MessageType } from './message-type.enum';

export interface ChatMessageRecord {
  chatId: number;
  messageId: number;
  userId?: number;
  username?: string;
  displayName: string;
  type: MessageType;
  text?: string;
  telegramFileId?: string;
  timestamp: Date;
  replyToMessageId?: number;
  transcription?: string;
  metadata: Record<string, unknown>;
}
