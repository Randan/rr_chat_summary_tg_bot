import type { ChatMessageRecord } from '../messages/chat-message.types';
import { MessageType } from '../messages/message-type.enum';
import { SummaryService } from './summary.service';
import type { SummaryFilter, SummaryLimitsResult } from './summary.types';

const NOW = new Date('2026-10-20T12:00:00Z');

function record(messageId: number, overrides: Partial<ChatMessageRecord> = {}): ChatMessageRecord {
  return {
    chatId: -100,
    messageId,
    displayName: 'Іван',
    type: MessageType.Text,
    text: `msg ${messageId}`,
    timestamp: new Date(NOW.getTime() - messageId * 1000),
    metadata: {},
    ...overrides,
  };
}

describe('SummaryService', () => {
  let repository: { findLatestByCount: jest.Mock; findSince: jest.Mock };
  let resolver: { resolveTranscriptions: jest.Mock };
  let limits: { apply: jest.Mock };
  let ai: { generateSummary: jest.Mock };
  let logger: { log: jest.Mock; error: jest.Mock };
  let service: SummaryService;
  let limited: SummaryLimitsResult;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    const messages = [record(1), record(2)];
    repository = {
      findLatestByCount: jest.fn().mockResolvedValue(messages),
      findSince: jest.fn().mockResolvedValue(messages),
    };
    resolver = { resolveTranscriptions: jest.fn(async (items: ChatMessageRecord[]) => items) };
    limited = {
      messages,
      requestedCount: 2,
      analyzedCount: 2,
      dialogText: 'Іван: msg 1\n\nІван: msg 2',
      periodLabel: 'p',
      skippedVoiceCount: 0,
    };
    limits = { apply: jest.fn(() => limited) };
    ai = { generateSummary: jest.fn().mockResolvedValue('Підсумок') };
    logger = { log: jest.fn(), error: jest.fn() };
    service = new SummaryService(
      {} as never,
      repository as never,
      resolver as never,
      limits as never,
      ai as never,
      logger as never,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('summarises the latest N messages for the count filter', async () => {
    const result = await service.buildSummary(-100, { type: 'count', value: 30 });

    expect(repository.findLatestByCount).toHaveBeenCalledWith(-100, 30);
    expect(resolver.resolveTranscriptions).toHaveBeenCalledWith([record(1), record(2)]);
    expect(limits.apply).toHaveBeenCalledWith(
      [record(1), record(2)],
      { type: 'count', value: 30 },
      'останні 30 повідомлень',
    );
    expect(ai.generateSummary).toHaveBeenCalledWith({
      dialogue: 'Іван: msg 1\n\nІван: msg 2',
      periodLabel: 'останні 30 повідомлень',
      analyzedInfo: 'Проаналізовано 2 повідомлень.',
    });
    expect(result).toEqual({ text: 'Підсумок', requestedCount: 2, analyzedCount: 2, skippedVoiceCount: 0 });
  });

  it.each<[SummaryFilter, number, string]>([
    [{ type: 'minutes', value: 15 }, 15 * 60 * 1000, 'останні 15 хвилин'],
    [{ type: 'hours', value: 3 }, 3 * 60 * 60 * 1000, 'останні 3 годин'],
    [{ type: 'days', value: 2 }, 2 * 24 * 60 * 60 * 1000, 'останні 2 днів'],
  ])('reads messages since the start of the period for %p', async (filter, periodMs, label) => {
    await service.buildSummary(-100, filter);
    expect(repository.findSince).toHaveBeenCalledWith(-100, new Date(NOW.getTime() - periodMs));
    expect(repository.findLatestByCount).not.toHaveBeenCalled();
    expect(ai.generateSummary.mock.calls[0][0].periodLabel).toBe(label);
  });

  it('answers without calling the AI when there are no messages', async () => {
    repository.findLatestByCount.mockResolvedValue([]);
    await expect(service.buildSummary(-100, { type: 'count', value: 5 })).resolves.toEqual({
      text: 'Немає повідомлень для аналізу в обраному періоді.',
      requestedCount: 0,
      analyzedCount: 0,
      skippedVoiceCount: 0,
    });
    expect(resolver.resolveTranscriptions).not.toHaveBeenCalled();
    expect(ai.generateSummary).not.toHaveBeenCalled();
  });

  it('treats an unknown filter type as no messages', async () => {
    const result = await service.buildSummary(-100, { type: 'weeks', value: 1 } as unknown as SummaryFilter);
    expect(result.text).toBe('Немає повідомлень для аналізу в обраному періоді.');
  });

  it('answers without calling the AI when there is no text content', async () => {
    limited = { ...limited, dialogText: '  ', skippedVoiceCount: 0 };
    const result = await service.buildSummary(-100, { type: 'count', value: 5 });
    expect(result.text).toBe('Не знайдено текстового вмісту для підсумку у обраному періоді.');
    expect(ai.generateSummary).not.toHaveBeenCalled();
  });

  it('mentions the skipped voice messages when there is no text content', async () => {
    limited = { ...limited, dialogText: '', skippedVoiceCount: 2 };
    const result = await service.buildSummary(-100, { type: 'count', value: 5 });
    expect(result).toEqual({
      text:
        'Не знайдено текстового вмісту для підсумку у обраному періоді.' +
        '\n\n⚠️ 2 голосових повідомлень без транскрипції не включено в підсумок.',
      requestedCount: 2,
      analyzedCount: 2,
      skippedVoiceCount: 2,
    });
  });

  it('appends the skipped-voice note to the summary', async () => {
    limited = { ...limited, skippedVoiceCount: 1 };
    const result = await service.buildSummary(-100, { type: 'count', value: 5 });
    expect(result.text).toBe('Підсумок\n\n⚠️ 1 голосових повідомлень без транскрипції не включено в підсумок.');
    expect(result.skippedVoiceCount).toBe(1);
  });

  it('tells the AI how many messages were analyzed when the limits trimmed some', async () => {
    limited = { ...limited, requestedCount: 10, analyzedCount: 4 };
    await service.buildSummary(-100, { type: 'count', value: 10 });
    expect(ai.generateSummary.mock.calls[0][0].analyzedInfo).toBe(
      'Проаналізовано 4 з 10 повідомлень (старіші було обрізано через ліміти).',
    );
    expect(logger.log).toHaveBeenCalledWith('Generating summary', {
      chatId: -100,
      requestedCount: 10,
      analyzedCount: 4,
      dialogLength: limited.dialogText.length,
    });
  });

  it('propagates an AI failure', async () => {
    ai.generateSummary.mockRejectedValue(new Error('ai down'));
    await expect(service.buildSummary(-100, { type: 'count', value: 5 })).rejects.toThrow('ai down');
  });
});
