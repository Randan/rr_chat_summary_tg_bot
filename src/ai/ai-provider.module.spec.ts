import type { FactoryProvider } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';

import { AI_PROVIDER } from './ai-provider.constants';
import { AiProviderModule } from './ai-provider.module';

function aiProviderFactory(): FactoryProvider['useFactory'] {
  const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AiProviderModule) as unknown[];
  const provider = providers.find(
    (item): item is FactoryProvider => typeof item === 'object' && (item as FactoryProvider).provide === AI_PROVIDER,
  );
  return provider!.useFactory;
}

describe('AiProviderModule AI_PROVIDER factory', () => {
  const gemini = { generateSummary: jest.fn() };

  it.each([['gemini'], ['GEMINI'], [undefined]])('returns the Gemini provider for AI_PROVIDER=%s', name => {
    expect(aiProviderFactory()({ get: () => name } as never, gemini as never)).toBe(gemini);
  });

  it('throws for a provider that is not implemented', () => {
    expect(() => aiProviderFactory()({ get: () => 'openai' } as never, gemini as never)).toThrow(
      'Unsupported AI_PROVIDER: openai',
    );
  });
});
