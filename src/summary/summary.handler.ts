import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService, NotifyAdminService } from '@randan/tg-logger';
import { Command, Ctx, Update } from 'nestjs-telegraf';
import type { Context } from 'telegraf';

import { extractCommandNumericArgument } from '../common/command-argument.util';
import { splitTelegramMessage } from '../common/telegram-message.util';
import { SummaryService } from './summary.service';
import type { SummaryFilter, SummaryFilterType } from './summary.types';
import { SummaryLockService } from './summary-lock.service';

const SUMMARY_IN_PROGRESS = 'Готую підсумок, зачекай трохи...';
const SUMMARY_FAILED = 'Не вдалося побудувати підсумок. Спробуй пізніше.';
const PRIVATE_CHAT_HINT =
  'Я працюю в групових чатах. Додай мене в групу і виконай команду там.\n\n' +
  'Команди: /summary, /summary_m, /summary_h, /summary_d\n\n' +
  'У BotFather вимкни Privacy mode, щоб я бачив усі повідомлення в групі.';
const HELP_MESSAGE = PRIVATE_CHAT_HINT;

@Update()
@Injectable()
export class SummaryHandler {
  constructor(
    private readonly summaryService: SummaryService,
    private readonly summaryLock: SummaryLockService,
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
    private readonly notifyAdmin: NotifyAdminService,
  ) {}

  @Command('start')
  async start(@Ctx() ctx: Context): Promise<void> {
    await this.sendHint(ctx);
  }

  @Command('help')
  async help(@Ctx() ctx: Context): Promise<void> {
    await this.sendHint(ctx);
  }

  @Command('summary')
  async summary(@Ctx() ctx: Context): Promise<void> {
    const defaultCount = this.config.get<number>('SUMMARY_DEFAULT_MESSAGE_COUNT', 50);
    await this.handleSummaryCommand(ctx, 'count', defaultCount);
  }

  @Command('summary_m')
  async summaryMinutes(@Ctx() ctx: Context): Promise<void> {
    const defaultMinutes = this.config.get<number>('SUMMARY_DEFAULT_MINUTES', 60);
    await this.handleSummaryCommand(ctx, 'minutes', defaultMinutes);
  }

  @Command('summary_h')
  async summaryHours(@Ctx() ctx: Context): Promise<void> {
    const defaultHours = this.config.get<number>('SUMMARY_DEFAULT_HOURS', 12);
    await this.handleSummaryCommand(ctx, 'hours', defaultHours);
  }

  @Command('summary_d')
  async summaryDays(@Ctx() ctx: Context): Promise<void> {
    const defaultDays = this.config.get<number>('SUMMARY_DEFAULT_DAYS', 7);
    await this.handleSummaryCommand(ctx, 'days', defaultDays);
  }

  private async sendHint(ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      return;
    }

    await ctx.telegram.sendMessage(chatId, HELP_MESSAGE);
  }

  private async handleSummaryCommand(ctx: Context, type: SummaryFilterType, defaultValue: number): Promise<void> {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      return;
    }

    if (ctx.chat?.type === 'private') {
      await ctx.telegram.sendMessage(chatId, PRIVATE_CHAT_HINT);
      return;
    }

    const arg = extractCommandNumericArgument(ctx);
    const value = arg ?? defaultValue;

    if (!Number.isInteger(value) || value <= 0) {
      await ctx.telegram.sendMessage(chatId, 'Невірний параметр. Вкажи додатне ціле число.');
      return;
    }

    const filter: SummaryFilter = { type, value };

    try {
      await ctx.telegram.sendChatAction(chatId, 'typing');
      await ctx.telegram.sendMessage(chatId, SUMMARY_IN_PROGRESS);

      const result = await this.summaryLock.runExclusive(chatId, () =>
        this.summaryService.buildSummary(chatId, filter),
      );

      await this.sendLongMessage(ctx, chatId, result.text);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error('Summary command failed', { chatId, type, value, errorMessage });
      await ctx.telegram.sendMessage(chatId, SUMMARY_FAILED);

      const adminId = this.config.get<string>('ADMIN_TELEGRAM_ID');
      if (adminId) {
        this.notifyAdmin.send(`Помилка підсумку в чаті ${chatId}: ${errorMessage}`);
      }
    }
  }

  private async sendLongMessage(ctx: Context, chatId: number, text: string): Promise<void> {
    const parts = splitTelegramMessage(text);

    for (const part of parts) {
      await ctx.telegram.sendMessage(chatId, part, {
        link_preview_options: { is_disabled: true },
      });
    }
  }
}
