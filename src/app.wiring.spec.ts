import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { BotKitModule, BotKitRegistry } from '@randan/tg-bot-kit';
import { LoggerModule, NotifyAdminModule } from '@randan/tg-logger';
import { getBotToken } from 'nestjs-telegraf';
import * as cron from 'node-cron';

import { AI_PROVIDER } from './ai/ai-provider.constants';
import { AiProviderModule } from './ai/ai-provider.module';
import { GeminiProvider } from './ai/providers/gemini.provider';
import { configValidationSchema } from './config/config.schema';
import { MessageCleanupService } from './messages/message-cleanup.service';
import { MessageIngestHandler } from './messages/message-ingest.handler';
import { MessagesModule } from './messages/messages.module';
import { ChatMessage } from './messages/schemas/chat-message.schema';
import { SummaryHandler } from './summary/summary.handler';
import { SummaryModule } from './summary/summary.module';
import { BOT_COMMANDS } from './telegram/bot-commands';
import { TranscriptionModule } from './transcription/transcription.module';
import { TranscriptionResolverService } from './transcription/transcription-resolver.service';

jest.mock('@google/genai', () => ({ GoogleGenAI: jest.fn(() => ({ models: { generateContent: jest.fn() } })) }));
jest.mock('node-cron', () => ({ schedule: jest.fn() }));

/** Stands in for TelegrafModule and the Mongo connection: global, like the real ones. */
@Global()
@Module({
  providers: [
    { provide: getBotToken(), useValue: { telegram: { setMyCommands: jest.fn() } } },
    { provide: getConnectionToken(), useValue: {} },
  ],
  exports: [getBotToken(), getConnectionToken()],
})
class FakeInfrastructureModule {}

/** A mongoose query that resolves to the given value, enough for the startup cleanup to find nothing to delete. */
function emptyQuery(result: unknown) {
  const chain = {
    sort: () => chain,
    limit: () => chain,
    select: () => chain,
    lean: () => chain,
    exec: async () => result,
  };
  return chain;
}

/** The real module graph without network or database: catches a provider Nest cannot resolve before it crashes on the Pi. */
describe('application wiring', () => {
  it('resolves every provider of the bot', async () => {
    const model = {
      db: { readyState: 1 },
      find: jest.fn(() => emptyQuery([])),
      distinct: jest.fn(() => emptyQuery([])),
      countDocuments: jest.fn(() => emptyQuery(0)),
    };
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validate: () =>
            configValidationSchema({
              BOT_TOKEN: 't',
              DB_URL: 'mongodb://localhost/chat',
              GEMINI_API_KEY: 'k',
              GEMINI_MODEL: 'gemini-2.5-flash',
              SUMMARY_DEFAULT_MESSAGE_COUNT: '50',
              SUMMARY_DEFAULT_MINUTES: '60',
              SUMMARY_DEFAULT_HOURS: '12',
              SUMMARY_DEFAULT_DAYS: '7',
              SUMMARY_MAX_MESSAGES: '500',
              SUMMARY_MAX_CHARACTERS: '50000',
              SUMMARY_MAX_TOKENS: '4096',
              TRANSCRIPTION_SERVICE_URL: 'http://localhost:4205',
              LOG_LEVEL: 'silent',
            }),
        }),
        FakeInfrastructureModule,
        LoggerModule,
        NotifyAdminModule,
        BotKitModule.forRoot({ name: 'chat-summary-tg-bot', commands: BOT_COMMANDS }),
        TranscriptionModule,
        MessagesModule,
        AiProviderModule,
        SummaryModule,
      ],
    })
      .overrideProvider(getModelToken(ChatMessage.name))
      .useValue(model)
      .compile();

    await moduleRef.init();
    // let the startup cleanup started in onModuleInit settle before closing
    await new Promise(resolve => setImmediate(resolve));

    expect(moduleRef.get(SummaryHandler)).toBeInstanceOf(SummaryHandler);
    expect(moduleRef.get(MessageIngestHandler)).toBeInstanceOf(MessageIngestHandler);
    expect(moduleRef.get(TranscriptionResolverService)).toBeInstanceOf(TranscriptionResolverService);
    expect(moduleRef.get(MessageCleanupService)).toBeInstanceOf(MessageCleanupService);
    expect(moduleRef.get(AI_PROVIDER)).toBeInstanceOf(GeminiProvider);
    expect(moduleRef.get(BotKitRegistry)).toBeInstanceOf(BotKitRegistry);
    expect(cron.schedule).toHaveBeenCalledTimes(1);
    expect(model.find).toHaveBeenCalled();
    await moduleRef.close();
  });
});
