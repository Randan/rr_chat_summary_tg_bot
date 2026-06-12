import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { LoggerModule, NotifyAdminModule } from '@randan/tg-logger';

import { HealthModule } from './common/health/health.module';
import { configValidationSchema } from './config/config.schema';
import { MessagesModule } from './messages/messages.module';
import { SummaryModule } from './summary/summary.module';
import { TelegramModule } from './telegram/telegram.module';
import { TranscriptionModule } from './transcription/transcription.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: configValidationSchema,
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('DB_URL'),
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
      }),
      inject: [ConfigService],
    }),
    LoggerModule,
    NotifyAdminModule,
    HealthModule,
    TranscriptionModule,
    MessagesModule,
    SummaryModule,
    TelegramModule,
  ],
})
export class AppModule {}
