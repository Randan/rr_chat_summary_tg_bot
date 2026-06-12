import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '@randan/tg-logger';
import { InjectBot } from 'nestjs-telegraf';
import type { Telegraf } from 'telegraf';

import { buildTelegramFileUrl } from './telegram-file.util';

interface TranscriptionApiResponse {
  text: string;
}

@Injectable()
export class TranscriptionClientService {
  constructor(
    private readonly config: ConfigService,
    @InjectBot() private readonly bot: Telegraf,
    private readonly logger: LoggerService,
  ) {}

  async transcribeTelegramFile(fileId: string, mimeType?: string): Promise<string> {
    const botToken = this.config.get<string>('BOT_TOKEN');
    const serviceUrl = this.config.get<string>('TRANSCRIPTION_SERVICE_URL');
    const timeoutMs = this.config.get<number>('TRANSCRIPTION_TIMEOUT_MS', 120000);

    if (!botToken || !serviceUrl) {
      throw new Error('Transcription client is not configured');
    }

    const file = await this.bot.telegram.getFile(fileId);
    if (!file.file_path) {
      throw new Error('Telegram file path missing');
    }

    const downloadUrl = buildTelegramFileUrl(botToken, file.file_path);
    const audioResponse = await fetch(downloadUrl);
    if (!audioResponse.ok) {
      throw new Error(`Failed to download audio: ${audioResponse.status}`);
    }

    const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: mimeType || 'audio/ogg' });
    formData.append('file', blob, 'audio.ogg');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${serviceUrl}/transcribe`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Transcription service error: ${response.status}`);
      }

      const payload = (await response.json()) as TranscriptionApiResponse;
      return payload.text?.trim() || '';
    } finally {
      clearTimeout(timeout);
    }
  }
}
