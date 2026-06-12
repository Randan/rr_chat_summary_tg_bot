import { Injectable } from '@nestjs/common';
import { LoggerService } from '@randan/tg-logger';
import type { Message } from 'telegraf/types';

import type { CreateChatMessageInput } from './message.repository';
import { MessageRepository } from './message.repository';
import { MessageType } from './message-type.enum';

const SERVICE_MESSAGE_KEYS = [
  'new_chat_members',
  'left_chat_member',
  'new_chat_title',
  'new_chat_photo',
  'delete_chat_photo',
  'pinned_message',
  'group_chat_created',
  'supergroup_chat_created',
  'channel_chat_created',
  'migrate_to_chat_id',
  'migrate_from_chat_id',
  'message_auto_delete_timer_changed',
  'forum_topic_created',
  'forum_topic_closed',
  'forum_topic_reopened',
  'general_forum_topic_hidden',
  'general_forum_topic_unhidden',
  'video_chat_scheduled',
  'video_chat_started',
  'video_chat_ended',
  'video_chat_participants_invited',
] as const;

function buildDisplayName(from?: Message.CommonMessage['from']): string {
  if (!from) {
    return 'Unknown';
  }
  const parts = [from.first_name, from.last_name].filter(Boolean);
  return parts.join(' ') || from.username || 'Unknown';
}

function extractReplyToMessageId(message: Message): number | undefined {
  if ('reply_to_message' in message && message.reply_to_message) {
    return message.reply_to_message.message_id;
  }
  return undefined;
}

function isServiceMessage(message: Message): boolean {
  return SERVICE_MESSAGE_KEYS.some(key => key in message);
}

@Injectable()
export class MessageIngestService {
  constructor(
    private readonly messageRepository: MessageRepository,
    private readonly logger: LoggerService,
  ) {}

  async ingest(message: Message): Promise<void> {
    const chatId = message.chat.id;

    if (isServiceMessage(message)) {
      this.logger.log('Skipping service message', { chatId, messageId: message.message_id });
      return;
    }

    const input = this.mapMessage(message);
    if (!input) {
      return;
    }

    await this.messageRepository.upsertMessage(input);
    this.logger.log('Message stored', {
      chatId: input.chatId,
      messageId: input.messageId,
      type: input.type,
    });
  }

  private mapMessage(message: Message): CreateChatMessageInput | null {
    const chatId = message.chat.id;
    const base = {
      chatId,
      messageId: message.message_id,
      userId: message.from?.id,
      username: message.from?.username,
      displayName: buildDisplayName(message.from),
      timestamp: new Date(message.date * 1000),
      replyToMessageId: extractReplyToMessageId(message),
      metadata: {},
    };

    if ('text' in message && message.text) {
      return { ...base, type: MessageType.Text, text: message.text };
    }

    if ('voice' in message && message.voice) {
      return {
        ...base,
        type: MessageType.Voice,
        telegramFileId: message.voice.file_id,
        metadata: {
          mimeType: message.voice.mime_type,
          duration: message.voice.duration,
        },
      };
    }

    if ('video_note' in message && message.video_note) {
      return {
        ...base,
        type: MessageType.VideoNote,
        telegramFileId: message.video_note.file_id,
        metadata: {
          duration: message.video_note.duration,
          length: message.video_note.length,
        },
      };
    }

    if ('photo' in message && message.photo?.length) {
      const largest = message.photo[message.photo.length - 1];
      return {
        ...base,
        type: MessageType.Photo,
        text: message.caption,
        telegramFileId: largest.file_id,
        metadata: { photoSize: largest.file_size },
      };
    }

    if ('document' in message && message.document) {
      return {
        ...base,
        type: MessageType.Document,
        text: message.caption,
        telegramFileId: message.document.file_id,
        metadata: {
          fileName: message.document.file_name,
          mimeType: message.document.mime_type,
        },
      };
    }

    if ('caption' in message && message.caption) {
      return {
        ...base,
        type: MessageType.Other,
        text: message.caption,
      };
    }

    this.logger.log('Skipping unsupported message type', {
      chatId,
      messageId: message.message_id,
    });
    return null;
  }
}
