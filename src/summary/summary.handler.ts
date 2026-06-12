import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService, NotifyAdminService } from '@randan/tg-logger';
import { Command, Ctx, Update } from 'nestjs-telegraf';
import type { Context } from 'telegraf';

import { SummaryService } from './summary.service';
import type { SummaryFilter, SummaryFilterType } from './summary.types';

const SUMMARY_IN_PROGRESS = 'Готую summary, зачекай трохи...';
const SUMMARY_FAILED = 'Не вдалося побудувати summary. Спробуй пізніше.';

@Update()
@Injectable()
export class SummaryHandler {
  constructor(
    private readonly summaryService: SummaryService,
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
    private readonly notifyAdmin: NotifyAdminService,
  ) {}

  @Command('summary')
  async summary(@Ctx() ctx: Context): Promise<void> {
    const defaultCount = this.config.get<number>('SUMMARY_DEFAULT_MESSAGE_COUNT', 50);
    await this.handleSummaryCommand(ctx, 'count', 'SUMMARY_DEFAULT_MESSAGE_COUNT', defaultCount);
  }

  @Command('summary_m')
  async summaryMinutes(@Ctx() ctx: Context): Promise<void> {
    const defaultMinutes = this.config.get<number>('SUMMARY_DEFAULT_MINUTES', 60);
    await this.handleSummaryCommand(ctx, 'minutes', 'SUMMARY_DEFAULT_MINUTES', defaultMinutes);
  }

  @Command('summary_h')
  async summaryHours(@Ctx() ctx: Context): Promise<void> {
    const defaultHours = this.config.get<number>('SUMMARY_DEFAULT_HOURS', 12);
    await this.handleSummaryCommand(ctx, 'hours', 'SUMMARY_DEFAULT_HOURS', defaultHours);
  }

  @Command('summary_d')
  async summaryDays(@Ctx() ctx: Context): Promise<void> {
    const defaultDays = this.config.get<number>('SUMMARY_DEFAULT_DAYS', 7);
    await this.handleSummaryCommand(ctx, 'days', 'SUMMARY_DEFAULT_DAYS', defaultDays);
  }

  private async handleSummaryCommand(
    ctx: Context,
    type: SummaryFilterType,
    defaultEnvKey: string,
    defaultValue: number,
  ): Promise<void> {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      return;
    }

    const arg = this.extractNumericArgument(ctx);
    const value = arg ?? defaultValue;

    if (!Number.isInteger(value) || value <= 0) {
      await ctx.telegram.sendMessage(chatId, `Невірний параметр. Використовуй значення з env ${defaultEnvKey}.`);
      return;
    }

    const filter: SummaryFilter = { type, value };

    try {
      await ctx.telegram.sendChatAction(chatId, 'typing');
      await ctx.telegram.sendMessage(chatId, SUMMARY_IN_PROGRESS);

      const result = await this.summaryService.buildSummary(chatId, filter);
      await ctx.telegram.sendMessage(chatId, result.text, {
        link_preview_options: { is_disabled: true },
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error('Summary command failed', { chatId, type, value, errorMessage });
      await ctx.telegram.sendMessage(chatId, SUMMARY_FAILED);

      const adminId = this.config.get<string>('ADMIN_TELEGRAM_ID');
      if (adminId) {
        this.notifyAdmin.send(`Summary error in chat ${chatId}: ${errorMessage}`, {
          parse_mode: 'Markdown',
        });
      }
    }
  }

  private extractNumericArgument(ctx: Context): number | undefined {
    const messageText =
      ctx.message && 'text' in ctx.message && typeof ctx.message.text === 'string' ? ctx.message.text : '';
    const parts = messageText.trim().split(/\s+/);
    if (parts.length < 2) {
      return undefined;
    }
    const parsed = Number(parts[1]);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
}
