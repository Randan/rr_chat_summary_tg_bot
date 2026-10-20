import { GoogleGenAI } from '@google/genai';
import type { OnModuleInit } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BotKitRegistry, formatDiagTime, isTransientError, retry, withTimeout } from '@randan/tg-bot-kit';
import { LoggerService } from '@randan/tg-logger';

import { SUMMARY_SYSTEM_PROMPT } from '../../config/summary.prompt';
import type { AiProvider } from '../ai-provider.interface';
import type { GenerateSummaryInput } from '../ai-provider.types';
import { GeminiQuotaError, mapGeminiError } from '../gemini-error.util';
import { buildSummaryUserPrompt } from '../summary-prompt.util';

@Injectable()
export class GeminiProvider implements AiProvider, OnModuleInit {
  private readonly client: GoogleGenAI;
  private lastSuccessAt: Date | null = null;
  private lastFailure: { message: string; at: Date } | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly registry: BotKitRegistry,
    private readonly logger: LoggerService,
  ) {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is required when AI_PROVIDER=gemini');
    }
    this.client = new GoogleGenAI({ apiKey });
  }

  onModuleInit(): void {
    this.registry.addDiagnostics('Gemini', () => [
      `модель: ${this.config.get<string>('GEMINI_MODEL') ?? '—'}`,
      `останній підсумок: ${formatDiagTime(this.lastSuccessAt)}`,
      `остання помилка: ${this.lastFailure ? `${formatDiagTime(this.lastFailure.at)}: ${this.lastFailure.message}` : '—'}`,
    ]);
  }

  async generateSummary(input: GenerateSummaryInput): Promise<string> {
    const model = this.config.get<string>('GEMINI_MODEL');
    const maxOutputTokens = this.config.get<number>('SUMMARY_MAX_TOKENS', 4096);

    if (!model) {
      throw new Error('GEMINI_MODEL is required when AI_PROVIDER=gemini');
    }

    const timeoutMs = this.config.get<number>('GEMINI_TIMEOUT_MS', 90_000);
    try {
      // a call Gemini never answers would hold the chat's summary lock forever
      const response = await retry(
        () =>
          withTimeout(
            this.client.models.generateContent({
              model,
              contents: buildSummaryUserPrompt(input),
              config: {
                systemInstruction: SUMMARY_SYSTEM_PROMPT,
                maxOutputTokens,
              },
            }),
            timeoutMs,
          ),
        {
          attempts: 2,
          delayMs: 3000,
          // a quota error does not pass in seconds: retrying it only burns more of the quota
          isRetryable: err => isTransientError(err) && !(mapGeminiError(err) instanceof GeminiQuotaError),
        },
      );

      const content = response.text?.trim();
      if (!content) {
        throw new Error('Gemini returned empty summary');
      }

      this.lastSuccessAt = new Date();
      return content;
    } catch (err) {
      const mappedError = mapGeminiError(err);
      const errorMessage = mappedError.message;
      this.lastFailure = { message: errorMessage, at: new Date() };
      this.logger.error('Gemini summary request failed', { model, errorMessage });
      throw mappedError;
    }
  }
}
