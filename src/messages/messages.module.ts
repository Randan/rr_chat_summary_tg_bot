import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import { MessageRepository } from './message.repository';
import { MessageCleanupService } from './message-cleanup.service';
import { MessageIngestHandler } from './message-ingest.handler';
import { MessageIngestService } from './message-ingest.service';
import { ChatMessage, ChatMessageSchema } from './schemas/chat-message.schema';
import { TranscriptionBotPresenceService } from './transcription-bot-presence.service';

@Module({
  imports: [
    MongooseModule.forFeatureAsync([
      {
        name: ChatMessage.name,
        imports: [ConfigModule],
        useFactory: (config: ConfigService) => {
          const schema = ChatMessageSchema;
          schema.set('collection', config.get<string>('DB_MESSAGES_COLLECTION'));
          return schema;
        },
        inject: [ConfigService],
      },
    ]),
  ],
  providers: [
    MessageRepository,
    MessageIngestService,
    MessageIngestHandler,
    MessageCleanupService,
    TranscriptionBotPresenceService,
  ],
  exports: [MessageRepository, MessageIngestService, TranscriptionBotPresenceService],
})
export class MessagesModule {}
