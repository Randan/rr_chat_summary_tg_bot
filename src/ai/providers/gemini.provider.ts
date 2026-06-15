import { GoogleGenAI } from '@google/genai';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '@randan/tg-logger';

import { SUMMARY_SYSTEM_PROMPT } from '../../config/summary.prompt';
import type { AiProvider } from '../ai-provider.interface';
import type { GenerateSummaryInput } from '../ai-provider.types';
import { buildSummaryUserPrompt } from '../summary-prompt.util';

@Injectable()
export class GeminiProvider implements AiProvider {
  private readonly client: GoogleGenAI;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is required when AI_PROVIDER=gemini');
    }
    this.client = new GoogleGenAI({ apiKey });
  }

  async generateSummary(input: GenerateSummaryInput): Promise<string> {
    const model = this.config.get<string>('GEMINI_MODEL');
    const maxOutputTokens = this.config.get<number>('SUMMARY_MAX_TOKENS', 4096);

    if (!model) {
      throw new Error('GEMINI_MODEL is required when AI_PROVIDER=gemini');
    }

    try {
      const response = await this.client.models.generateContent({
        model,
        contents: buildSummaryUserPrompt(input),
        config: {
          systemInstruction: SUMMARY_SYSTEM_PROMPT,
          maxOutputTokens,
        },
      });

      const content = response.text?.trim();
      if (!content) {
        throw new Error('Gemini returned empty summary');
      }

      return content;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error('Gemini summary request failed', { model, errorMessage });
      throw err;
    }
  }
}
