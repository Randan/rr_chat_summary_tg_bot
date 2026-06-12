import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

import { MessageType } from '../message-type.enum';

@Schema({ timestamps: false })
export class ChatMessage extends Document {
  @Prop({ required: true, index: true })
  chatId!: number;

  @Prop({ required: true })
  messageId!: number;

  @Prop()
  userId?: number;

  @Prop()
  username?: string;

  @Prop({ required: true })
  displayName!: string;

  @Prop({ required: true, enum: MessageType })
  type!: MessageType;

  @Prop()
  text?: string;

  @Prop()
  telegramFileId?: string;

  @Prop({ required: true, index: true })
  timestamp!: Date;

  @Prop()
  replyToMessageId?: number;

  @Prop()
  transcription?: string;

  @Prop({ type: Object, default: {} })
  metadata!: Record<string, unknown>;
}

export const ChatMessageSchema = SchemaFactory.createForClass(ChatMessage);
ChatMessageSchema.index({ chatId: 1, messageId: 1 }, { unique: true });
ChatMessageSchema.index({ chatId: 1, timestamp: -1 });
