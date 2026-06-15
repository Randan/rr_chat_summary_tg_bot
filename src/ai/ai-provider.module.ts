import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AI_PROVIDER, AiProviderName } from './ai-provider.constants';
import type { AiProvider } from './ai-provider.interface';
import { GeminiProvider } from './providers/gemini.provider';

@Module({
  providers: [
    GeminiProvider,
    {
      provide: AI_PROVIDER,
      useFactory: (config: ConfigService, geminiProvider: GeminiProvider): AiProvider => {
        const providerName = (config.get<string>('AI_PROVIDER') || AiProviderName.Gemini).toLowerCase();

        switch (providerName) {
          case AiProviderName.Gemini:
            return geminiProvider;
          default:
            throw new Error(`Unsupported AI_PROVIDER: ${providerName}`);
        }
      },
      inject: [ConfigService, GeminiProvider],
    },
  ],
  exports: [AI_PROVIDER],
})
export class AiProviderModule {}
