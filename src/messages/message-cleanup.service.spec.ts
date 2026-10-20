import * as cron from 'node-cron';

import { MessageCleanupService } from './message-cleanup.service';

jest.mock('node-cron', () => ({ schedule: jest.fn() }));

const NOW = new Date('2026-10-20T10:15:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

describe('MessageCleanupService', () => {
  let settings: Record<string, unknown>;
  let repository: {
    deleteOlderThan: jest.Mock;
    trimChatsOverLimit: jest.Mock;
    trimToMaxTotal: jest.Mock;
    countAll: jest.Mock;
  };
  let registry: { addDiagnostics: jest.Mock };
  let logger: { log: jest.Mock; error: jest.Mock };
  let notifyAdmin: { send: jest.Mock };
  let service: MessageCleanupService;

  async function diagLines(): Promise<string[]> {
    const [, section] = registry.addDiagnostics.mock.calls[0];
    return section();
  }

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    (cron.schedule as jest.Mock).mockClear();
    settings = { ADMIN_TELEGRAM_ID: '42' };
    repository = {
      deleteOlderThan: jest.fn().mockResolvedValue(3),
      trimChatsOverLimit: jest.fn().mockResolvedValue(2),
      trimToMaxTotal: jest.fn().mockResolvedValue(1),
      countAll: jest.fn().mockResolvedValue(100),
    };
    registry = { addDiagnostics: jest.fn() };
    logger = { log: jest.fn(), error: jest.fn() };
    notifyAdmin = { send: jest.fn() };
    service = new MessageCleanupService(
      { get: <T>(key: string, fallback?: T) => (key in settings ? settings[key] : fallback) } as never,
      repository as never,
      registry as never,
      logger as never,
      notifyAdmin as never,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('schedules the cleanup with the default cron and time zone and runs one on startup', async () => {
    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);

    expect(cron.schedule).toHaveBeenCalledWith('0 3 * * *', expect.any(Function), { timezone: 'Europe/Kyiv' });
    expect(logger.log).toHaveBeenCalledWith('Message cleanup cron registered', {
      cronExpression: '0 3 * * *',
      timeZone: 'Europe/Kyiv',
    });
    expect(repository.deleteOlderThan).toHaveBeenCalledTimes(1);
  });

  it('uses MESSAGE_CLEANUP_CRON and TIMEZONE, and the cron tick runs a cleanup', async () => {
    settings.MESSAGE_CLEANUP_CRON = '*/5 * * * *';
    settings.TIMEZONE = 'UTC';
    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);

    const [expression, tick, options] = (cron.schedule as jest.Mock).mock.calls[0];
    expect(expression).toBe('*/5 * * * *');
    expect(options).toEqual({ timezone: 'UTC' });

    tick();
    await jest.advanceTimersByTimeAsync(0);
    expect(repository.deleteOlderThan).toHaveBeenCalledTimes(2);
    expect(logger.log).toHaveBeenLastCalledWith(
      'Message cleanup completed',
      expect.objectContaining({ trigger: 'cron' }),
    );
  });

  it('applies the default retention, caps and batch size', async () => {
    await service.runCleanup('manual');

    expect(repository.deleteOlderThan).toHaveBeenCalledWith(new Date(NOW.getTime() - 30 * DAY_MS), 500);
    expect(repository.trimChatsOverLimit).toHaveBeenCalledWith(10_000, 500);
    expect(repository.trimToMaxTotal).toHaveBeenCalledWith(80_000, 500);
    expect(logger.log).toHaveBeenCalledWith('Message cleanup completed', {
      trigger: 'manual',
      retentionDays: 30,
      deletedByAge: 3,
      deletedByChatLimit: 2,
      deletedByTotalLimit: 1,
      remaining: 100,
      maxTotalDocuments: 80_000,
      maxMessagesPerChat: 10_000,
    });
    expect(notifyAdmin.send).not.toHaveBeenCalled();
  });

  it('skips the caps that are set to 0', async () => {
    Object.assign(settings, {
      MESSAGE_RETENTION_DAYS: 7,
      MESSAGE_MAX_TOTAL_DOCUMENTS: 0,
      MESSAGE_MAX_MESSAGES_PER_CHAT: 0,
      MESSAGE_CLEANUP_BATCH_SIZE: 50,
    });
    repository.countAll.mockResolvedValue(1_000_000);
    await service.runCleanup('manual');

    expect(repository.deleteOlderThan).toHaveBeenCalledWith(new Date(NOW.getTime() - 7 * DAY_MS), 50);
    expect(repository.trimChatsOverLimit).not.toHaveBeenCalled();
    expect(repository.trimToMaxTotal).not.toHaveBeenCalled();
    expect(notifyAdmin.send).not.toHaveBeenCalled();
  });

  it('skips a run while another is in progress', async () => {
    let finishFirst!: (value: number) => void;
    repository.deleteOlderThan.mockReturnValueOnce(new Promise<number>(resolve => (finishFirst = resolve)));

    const first = service.runCleanup('cron');
    await service.runCleanup('manual');
    expect(logger.log).toHaveBeenCalledWith('Message cleanup skipped because another run is in progress', {
      trigger: 'manual',
    });
    expect(repository.deleteOlderThan).toHaveBeenCalledTimes(1);

    finishFirst(0);
    await first;
    await service.runCleanup('manual');
    expect(repository.deleteOlderThan).toHaveBeenCalledTimes(2);
  });

  it('alerts the admin when the store is at 90% of the cap after cleanup', async () => {
    settings.MESSAGE_MAX_TOTAL_DOCUMENTS = 1000;
    repository.countAll.mockResolvedValue(900);
    await service.runCleanup('cron');
    expect(notifyAdmin.send).toHaveBeenCalledWith(
      'MongoDB message store is near the configured cap: 900/1000 documents after cleanup.',
    );
  });

  it('does not alert below 90% of the cap or without an admin', async () => {
    settings.MESSAGE_MAX_TOTAL_DOCUMENTS = 1000;
    repository.countAll.mockResolvedValue(899);
    await service.runCleanup('cron');

    delete settings.ADMIN_TELEGRAM_ID;
    repository.countAll.mockResolvedValue(1000);
    await service.runCleanup('cron');
    expect(notifyAdmin.send).not.toHaveBeenCalled();
  });

  it('logs a failure, alerts the admin and lets the next run start', async () => {
    repository.deleteOlderThan.mockRejectedValueOnce(new Error('db down'));
    await service.runCleanup('startup');

    expect(logger.error).toHaveBeenCalledWith('Message cleanup failed', {
      trigger: 'startup',
      errorMessage: 'db down',
    });
    expect(notifyAdmin.send).toHaveBeenCalledWith('Message cleanup failed (startup): db down');

    await service.runCleanup('manual');
    expect(repository.deleteOlderThan).toHaveBeenCalledTimes(2);
  });

  it('reports a non-Error failure as unknown and stays quiet without an admin', async () => {
    delete settings.ADMIN_TELEGRAM_ID;
    repository.countAll.mockRejectedValueOnce('weird');
    await service.runCleanup('cron');
    expect(logger.error).toHaveBeenCalledWith('Message cleanup failed', {
      trigger: 'cron',
      errorMessage: 'Unknown error',
    });
    expect(notifyAdmin.send).not.toHaveBeenCalled();
  });

  it('shows the stored count and the last cleanup in /diag', async () => {
    repository.deleteOlderThan.mockReturnValueOnce(new Promise(() => undefined));
    service.onModuleInit();
    expect(registry.addDiagnostics).toHaveBeenCalledWith('Повідомлення в базі', expect.any(Function));
    expect(await diagLines()).toEqual(['зберігається: 100 (ліміт 80000)', 'останнє очищення: —']);

    service = new MessageCleanupService(
      { get: <T>(key: string, fallback?: T) => (key in settings ? settings[key] : fallback) } as never,
      repository as never,
      registry as never,
      logger as never,
      notifyAdmin as never,
    );
    registry.addDiagnostics.mockClear();
    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    expect((await diagLines())[1]).toBe('останнє очищення: 20.10, 13:15 (startup), видалено 6');

    repository.deleteOlderThan.mockRejectedValueOnce(new Error('db down'));
    await service.runCleanup('manual');
    expect((await diagLines())[1]).toBe('останнє очищення: 20.10, 13:15 (manual), ⚠️ db down');
  });
});
