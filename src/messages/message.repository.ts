import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import type { ChatMessageRecord } from './chat-message.types';
import { ChatMessage } from './schemas/chat-message.schema';

export interface CreateChatMessageInput {
  chatId: number;
  messageId: number;
  userId?: number;
  username?: string;
  displayName: string;
  type: ChatMessage['type'];
  text?: string;
  telegramFileId?: string;
  timestamp: Date;
  replyToMessageId?: number;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class MessageRepository {
  constructor(@InjectModel(ChatMessage.name) private readonly messageModel: Model<ChatMessage>) {}

  async upsertMessage(input: CreateChatMessageInput): Promise<ChatMessage> {
    return this.messageModel
      .findOneAndUpdate(
        { chatId: input.chatId, messageId: input.messageId },
        {
          $setOnInsert: {
            chatId: input.chatId,
            messageId: input.messageId,
            userId: input.userId,
            username: input.username,
            displayName: input.displayName,
            type: input.type,
            text: input.text,
            telegramFileId: input.telegramFileId,
            timestamp: input.timestamp,
            replyToMessageId: input.replyToMessageId,
            metadata: input.metadata ?? {},
          },
        },
        { upsert: true, new: true },
      )
      .exec();
  }

  async findLatestByCount(chatId: number, count: number): Promise<ChatMessageRecord[]> {
    const messages = await this.messageModel.find({ chatId }).sort({ timestamp: -1 }).limit(count).lean().exec();
    return messages.reverse() as ChatMessageRecord[];
  }

  async findSince(chatId: number, since: Date): Promise<ChatMessageRecord[]> {
    return this.messageModel
      .find({ chatId, timestamp: { $gte: since } })
      .sort({ timestamp: 1 })
      .lean()
      .exec() as Promise<ChatMessageRecord[]>;
  }

  async findTranscriptionReplies(
    chatId: number,
    replyToMessageId: number,
    transcriptionBotUsername: string,
  ): Promise<ChatMessageRecord[]> {
    const firstReply = await this.messageModel
      .findOne({
        chatId,
        replyToMessageId,
        username: transcriptionBotUsername,
        type: 'text',
      })
      .sort({ timestamp: 1 })
      .lean()
      .exec();

    if (!firstReply) {
      return [];
    }

    const continuation = await this.messageModel
      .find({
        chatId,
        username: transcriptionBotUsername,
        type: 'text',
        messageId: { $gt: firstReply.messageId },
        timestamp: { $lte: new Date(firstReply.timestamp.getTime() + 2 * 60 * 1000) },
      })
      .sort({ messageId: 1 })
      .lean()
      .exec();

    const replies = [firstReply as ChatMessageRecord];

    for (const message of continuation) {
      if (message.replyToMessageId && message.replyToMessageId !== replyToMessageId) {
        break;
      }
      replies.push(message as ChatMessageRecord);
    }

    return replies;
  }

  async hasTranscriptionBotMessages(chatId: number, transcriptionBotUsername: string): Promise<boolean> {
    const doc = await this.messageModel
      .findOne({ chatId, username: transcriptionBotUsername })
      .select({ _id: 1 })
      .lean()
      .exec();
    return Boolean(doc);
  }

  async saveTranscription(chatId: number, messageId: number, transcription: string): Promise<void> {
    await this.messageModel.updateOne({ chatId, messageId }, { $set: { transcription } }).exec();
  }

  async migrateChatId(fromChatId: number, toChatId: number): Promise<number> {
    const result = await this.messageModel.updateMany({ chatId: fromChatId }, { $set: { chatId: toChatId } }).exec();
    return result.modifiedCount;
  }

  async updateEditedMessage(input: CreateChatMessageInput): Promise<void> {
    await this.messageModel
      .updateOne(
        { chatId: input.chatId, messageId: input.messageId },
        {
          $set: {
            text: input.text,
            displayName: input.displayName,
            username: input.username,
            metadata: input.metadata ?? {},
          },
          $setOnInsert: {
            chatId: input.chatId,
            messageId: input.messageId,
            userId: input.userId,
            type: input.type,
            telegramFileId: input.telegramFileId,
            timestamp: input.timestamp,
            replyToMessageId: input.replyToMessageId,
          },
        },
        { upsert: true },
      )
      .exec();
  }

  async countAll(): Promise<number> {
    return this.messageModel.countDocuments().exec();
  }

  async deleteOlderThan(cutoff: Date, batchSize: number): Promise<number> {
    let totalDeleted = 0;

    while (true) {
      const staleMessages = await this.messageModel
        .find({ timestamp: { $lt: cutoff } })
        .sort({ timestamp: 1 })
        .limit(batchSize)
        .select({ _id: 1 })
        .lean()
        .exec();

      if (staleMessages.length === 0) {
        break;
      }

      const ids = staleMessages.map(message => message._id);
      const result = await this.messageModel.deleteMany({ _id: { $in: ids } }).exec();
      totalDeleted += result.deletedCount ?? 0;

      if (staleMessages.length < batchSize) {
        break;
      }
    }

    return totalDeleted;
  }

  async trimToMaxTotal(maxTotal: number, batchSize: number): Promise<number> {
    let totalDeleted = 0;

    while (true) {
      const currentTotal = await this.countAll();
      if (currentTotal <= maxTotal) {
        break;
      }

      const excess = Math.min(currentTotal - maxTotal, batchSize);
      const oldestMessages = await this.messageModel
        .find({})
        .sort({ timestamp: 1 })
        .limit(excess)
        .select({ _id: 1 })
        .lean()
        .exec();

      if (oldestMessages.length === 0) {
        break;
      }

      const ids = oldestMessages.map(message => message._id);
      const result = await this.messageModel.deleteMany({ _id: { $in: ids } }).exec();
      totalDeleted += result.deletedCount ?? 0;

      if (oldestMessages.length < excess) {
        break;
      }
    }

    return totalDeleted;
  }

  async trimChatsOverLimit(maxMessagesPerChat: number, batchSize: number): Promise<number> {
    const chatIds = await this.messageModel.distinct('chatId').exec();
    let totalDeleted = 0;

    for (const chatId of chatIds) {
      totalDeleted += await this.trimChatToLimit(chatId, maxMessagesPerChat, batchSize);
    }

    return totalDeleted;
  }

  private async trimChatToLimit(chatId: number, maxMessagesPerChat: number, batchSize: number): Promise<number> {
    let totalDeleted = 0;

    while (true) {
      const currentCount = await this.messageModel.countDocuments({ chatId }).exec();
      if (currentCount <= maxMessagesPerChat) {
        break;
      }

      const excess = Math.min(currentCount - maxMessagesPerChat, batchSize);
      const oldestMessages = await this.messageModel
        .find({ chatId })
        .sort({ timestamp: 1 })
        .limit(excess)
        .select({ _id: 1 })
        .lean()
        .exec();

      if (oldestMessages.length === 0) {
        break;
      }

      const ids = oldestMessages.map(message => message._id);
      const result = await this.messageModel.deleteMany({ _id: { $in: ids } }).exec();
      totalDeleted += result.deletedCount ?? 0;

      if (oldestMessages.length < excess) {
        break;
      }
    }

    return totalDeleted;
  }
}
