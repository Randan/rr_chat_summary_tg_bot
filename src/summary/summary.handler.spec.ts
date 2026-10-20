import { GeminiQuotaError } from '../ai/gemini-error.util';
import { SummaryHandler } from './summary.handler';

const PRIVATE_CHAT_HINT =
  'Я працюю в групових чатах. Додай мене в групу і виконай команду там.\n\n' +
  'Команди: /summary, /summary_m, /summary_h, /summary_d\n\n' +
  'У BotFather вимкни Privacy mode, щоб я бачив усі повідомлення в групі.';

interface FakeContext {
  chat?: { id: number; type: string };
  message?: { text: string };
  telegram: { sendMessage: jest.Mock; sendChatAction: jest.Mock };
}

function ctx(text: string, chat: FakeContext['chat'] | null = { id: -100, type: 'group' }): FakeContext {
  return {
    chat: chat ?? undefined,
    message: { text },
    telegram: { sendMessage: jest.fn().mockResolvedValue({}), sendChatAction: jest.fn().mockResolvedValue(true) },
  };
}

describe('SummaryHandler', () => {
  let summaryService: { buildSummary: jest.Mock };
  let summaryLock: { runExclusive: jest.Mock };
  let settings: Record<string, unknown>;
  let logger: { log: jest.Mock; error: jest.Mock };
  let notifyAdmin: { send: jest.Mock };
  let handler: SummaryHandler;

  beforeEach(() => {
    summaryService = { buildSummary: jest.fn().mockResolvedValue({ text: 'Підсумок' }) };
    summaryLock = { runExclusive: jest.fn((_chatId: number, task: () => Promise<unknown>) => task()) };
    settings = { ADMIN_TELEGRAM_ID: '42' };
    logger = { log: jest.fn(), error: jest.fn() };
    notifyAdmin = { send: jest.fn() };
    handler = new SummaryHandler(
      summaryService as never,
      summaryLock as never,
      { get: <T>(key: string, fallback?: T) => (key in settings ? settings[key] : fallback) } as never,
      logger as never,
      notifyAdmin as never,
    );
  });

  it.each(['start', 'help'] as const)('/%s sends the usage hint', async command => {
    const context = ctx(`/${command}`);
    await handler[command](context as never);
    expect(context.telegram.sendMessage).toHaveBeenCalledWith(-100, PRIVATE_CHAT_HINT);
  });

  it('ignores /help without a chat', async () => {
    const context = ctx('/help', null);
    await handler.help(context as never);
    expect(context.telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('ignores a summary command without a chat', async () => {
    const context = ctx('/summary', null);
    await handler.summary(context as never);
    expect(context.telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('answers a private chat with the group-only hint', async () => {
    const context = ctx('/summary', { id: 5, type: 'private' });
    await handler.summary(context as never);
    expect(context.telegram.sendMessage).toHaveBeenCalledWith(5, PRIVATE_CHAT_HINT);
    expect(summaryService.buildSummary).not.toHaveBeenCalled();
  });

  it.each(['/summary 0', '/summary -5', '/summary 2.5'])('rejects the invalid argument in "%s"', async text => {
    const context = ctx(text);
    await handler.summary(context as never);
    expect(context.telegram.sendMessage).toHaveBeenCalledWith(-100, 'Невірний параметр. Вкажи додатне ціле число.');
    expect(summaryService.buildSummary).not.toHaveBeenCalled();
  });

  it.each([
    ['summary', 'count', 50],
    ['summaryMinutes', 'minutes', 60],
    ['summaryHours', 'hours', 12],
    ['summaryDays', 'days', 7],
  ] as const)('%s uses the built-in default %s value without an argument', async (method, type, value) => {
    const context = ctx('/cmd');
    await handler[method](context as never);
    expect(summaryService.buildSummary).toHaveBeenCalledWith(-100, { type, value });
  });

  it.each([
    ['summary', 'SUMMARY_DEFAULT_MESSAGE_COUNT', 'count'],
    ['summaryMinutes', 'SUMMARY_DEFAULT_MINUTES', 'minutes'],
    ['summaryHours', 'SUMMARY_DEFAULT_HOURS', 'hours'],
    ['summaryDays', 'SUMMARY_DEFAULT_DAYS', 'days'],
  ] as const)('%s takes its default from %s', async (method, key, type) => {
    settings[key] = 3;
    await handler[method](ctx('/cmd') as never);
    expect(summaryService.buildSummary).toHaveBeenCalledWith(-100, { type, value: 3 });
  });

  it('uses the argument, shows progress and sends the summary inside the chat lock', async () => {
    const context = ctx('/summary_h 4');
    await handler.summaryHours(context as never);

    expect(context.telegram.sendChatAction).toHaveBeenCalledWith(-100, 'typing');
    expect(summaryLock.runExclusive).toHaveBeenCalledWith(-100, expect.any(Function));
    expect(summaryService.buildSummary).toHaveBeenCalledWith(-100, { type: 'hours', value: 4 });
    expect(context.telegram.sendMessage.mock.calls).toEqual([
      [-100, 'Готую підсумок, зачекай трохи...'],
      [-100, 'Підсумок', { link_preview_options: { is_disabled: true } }],
    ]);
  });

  it('splits a long summary into several messages', async () => {
    const first = 'a'.repeat(4000);
    const second = 'b'.repeat(200);
    summaryService.buildSummary.mockResolvedValue({ text: `${first}\n${second}` });
    const context = ctx('/summary');
    await handler.summary(context as never);
    expect(context.telegram.sendMessage.mock.calls.slice(1)).toEqual([
      [-100, first, { link_preview_options: { is_disabled: true } }],
      [-100, second, { link_preview_options: { is_disabled: true } }],
    ]);
  });

  it('explains a Gemini quota error to the user', async () => {
    summaryService.buildSummary.mockRejectedValue(new GeminiQuotaError('429'));
    const context = ctx('/summary');
    await handler.summary(context as never);
    expect(context.telegram.sendMessage).toHaveBeenLastCalledWith(
      -100,
      'Квота Gemini API вичерпана або модель недоступна на free tier.\n\n' +
        'Спробуй пізніше або онови на сервері:\n' +
        'GEMINI_MODEL=gemini-2.5-flash',
    );
    expect(notifyAdmin.send).toHaveBeenCalledWith('Помилка підсумку в чаті -100: 429');
  });

  it('reports a generic failure to the user, the log and the admin', async () => {
    summaryService.buildSummary.mockRejectedValue(new Error('db down'));
    const context = ctx('/summary_d 2');
    await handler.summaryDays(context as never);

    expect(context.telegram.sendMessage).toHaveBeenLastCalledWith(
      -100,
      'Не вдалося побудувати підсумок. Спробуй пізніше.',
    );
    expect(logger.error).toHaveBeenCalledWith('Summary command failed', {
      chatId: -100,
      type: 'days',
      value: 2,
      errorMessage: 'db down',
    });
    expect(notifyAdmin.send).toHaveBeenCalledWith('Помилка підсумку в чаті -100: db down');
  });

  it('does not notify anyone without ADMIN_TELEGRAM_ID and handles a non-Error failure', async () => {
    delete settings.ADMIN_TELEGRAM_ID;
    summaryService.buildSummary.mockRejectedValue('weird');
    const context = ctx('/summary');
    await handler.summary(context as never);
    expect(logger.error.mock.calls[0][1].errorMessage).toBe('Unknown error');
    expect(context.telegram.sendMessage).toHaveBeenLastCalledWith(
      -100,
      'Не вдалося побудувати підсумок. Спробуй пізніше.',
    );
    expect(notifyAdmin.send).not.toHaveBeenCalled();
  });
});
