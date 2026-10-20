import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isTransientError, retry } from '@randan/tg-bot-kit';
import { LoggerService } from '@randan/tg-logger';
import { InjectBot } from 'nestjs-telegraf';
import type { Telegraf } from 'telegraf';

import { buildTelegramFileUrl } from './telegram-file.util';

/** Downloading a voice message from Telegram; the transcription itself has TRANSCRIPTION_TIMEOUT_MS. */
const DOWNLOAD_TIMEOUT_MS = 30_000;

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
    const audioBuffer = await retry(
      async () => {
        const audioResponse = await fetch(downloadUrl, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
        if (!audioResponse.ok) {
          throw Object.assign(new Error(`Failed to download audio: ${audioResponse.status}`), {
            status: audioResponse.status,
          });
        }
        return Buffer.from(await audioResponse.arrayBuffer());
      },
      {
        attempts: 3,
        delayMs: 1000,
        isRetryable: err => (err as Error)?.name === 'TimeoutError' || isTransientError(err),
      },
    );
    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: mimeType || 'audio/ogg' });
    formData.append('file', blob, 'audio.ogg');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const token = this.config.get<string>('TRANSCRIPTION_SERVICE_TOKEN');
      const response = await fetch(`${serviceUrl}/transcribe`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
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
