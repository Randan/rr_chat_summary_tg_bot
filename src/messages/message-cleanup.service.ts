import type { OnModuleInit } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService, NotifyAdminService } from '@randan/tg-logger';
import * as cron from 'node-cron';

import { MessageRepository } from './message.repository';

const DEFAULT_CLEANUP_CRON = '0 3 * * *';
const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_MAX_TOTAL_DOCUMENTS = 80_000;
const DEFAULT_MAX_MESSAGES_PER_CHAT = 10_000;
const DEFAULT_CLEANUP_BATCH_SIZE = 500;

@Injectable()
export class MessageCleanupService implements OnModuleInit {
  private cleanupInProgress = false;

  constructor(
    private readonly config: ConfigService,
    private readonly messageRepository: MessageRepository,
    private readonly logger: LoggerService,
    private readonly notifyAdmin: NotifyAdminService,
  ) {}

  onModuleInit(): void {
    const timeZone = this.config.get<string>('TIMEZONE') || 'Europe/Kyiv';
    const cronExpression = this.config.get<string>('MESSAGE_CLEANUP_CRON') || DEFAULT_CLEANUP_CRON;

    cron.schedule(
      cronExpression,
      () => {
        void this.runCleanup('cron');
      },
      { timezone: timeZone },
    );

    this.logger.log('Message cleanup cron registered', { cronExpression, timeZone });

    void this.runCleanup('startup');
  }

  async runCleanup(trigger: 'startup' | 'cron' | 'manual'): Promise<void> {
    if (this.cleanupInProgress) {
      this.logger.log('Message cleanup skipped because another run is in progress', { trigger });
      return;
    }

    this.cleanupInProgress = true;

    try {
      const retentionDays = this.config.get<number>('MESSAGE_RETENTION_DAYS', DEFAULT_RETENTION_DAYS);
      const maxTotalDocuments = this.config.get<number>('MESSAGE_MAX_TOTAL_DOCUMENTS', DEFAULT_MAX_TOTAL_DOCUMENTS);
      const maxMessagesPerChat = this.config.get<number>(
        'MESSAGE_MAX_MESSAGES_PER_CHAT',
        DEFAULT_MAX_MESSAGES_PER_CHAT,
      );
      const batchSize = this.config.get<number>('MESSAGE_CLEANUP_BATCH_SIZE', DEFAULT_CLEANUP_BATCH_SIZE);
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

      const deletedByAge = await this.messageRepository.deleteOlderThan(cutoff, batchSize);
      const deletedByChatLimit =
        maxMessagesPerChat > 0 ? await this.messageRepository.trimChatsOverLimit(maxMessagesPerChat, batchSize) : 0;
      const deletedByTotalLimit =
        maxTotalDocuments > 0 ? await this.messageRepository.trimToMaxTotal(maxTotalDocuments, batchSize) : 0;

      const remaining = await this.messageRepository.countAll();

      this.logger.log('Message cleanup completed', {
        trigger,
        retentionDays,
        deletedByAge,
        deletedByChatLimit,
        deletedByTotalLimit,
        remaining,
        maxTotalDocuments,
        maxMessagesPerChat,
      });

      if (maxTotalDocuments > 0 && remaining >= Math.floor(maxTotalDocuments * 0.9)) {
        const adminId = this.config.get<string>('ADMIN_TELEGRAM_ID');
        if (adminId) {
          this.notifyAdmin.send(
            `MongoDB message store is near the configured cap: ${remaining}/${maxTotalDocuments} documents after cleanup.`,
          );
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error('Message cleanup failed', { trigger, errorMessage });

      const adminId = this.config.get<string>('ADMIN_TELEGRAM_ID');
      if (adminId) {
        this.notifyAdmin.send(`Message cleanup failed (${trigger}): ${errorMessage}`);
      }
    } finally {
      this.cleanupInProgress = false;
    }
  }
}
