import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '@randan/tg-logger';

import { SUMMARY_SYSTEM_PROMPT } from '../config/summary.prompt';

interface OpenAiChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

@Injectable()
export class OpenAiService {
  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {}

  async summarizeDialog(dialogText: string, periodLabel: string, analyzedInfo: string): Promise<string> {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    const model = this.config.get<string>('OPENAI_MODEL');
    const maxTokens = this.config.get<number>('SUMMARY_MAX_TOKENS', 4096);

    if (!apiKey || !model) {
      throw new Error('OpenAI is not configured');
    }

    const userPrompt = [`Період аналізу: ${periodLabel}`, analyzedInfo, '', 'Лог чату:', dialogText].join('\n');

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      this.logger.error('OpenAI request failed', { status: response.status, body });
      throw new Error(`OpenAI request failed: ${response.status}`);
    }

    const payload = (await response.json()) as OpenAiChatResponse;
    const content = payload.choices?.[0]?.message?.content?.trim();

    if (!content) {
      throw new Error('OpenAI returned empty summary');
    }

    return content;
  }
}
