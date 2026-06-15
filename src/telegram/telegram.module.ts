import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule } from 'nestjs-telegraf';

import { MessagesModule } from '../messages/messages.module';
import { SummaryModule } from '../summary/summary.module';
import { BotCommandsService } from './bot-commands.service';

@Module({
  imports: [
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => {
        const token = config.get<string>('BOT_TOKEN');
        if (!token) {
          throw new Error('BOT_TOKEN is required');
        }
        return { token, include: [MessagesModule, SummaryModule] };
      },
      inject: [ConfigService],
    }),
    MessagesModule,
    SummaryModule,
  ],
  providers: [BotCommandsService],
})
export class TelegramModule {}
