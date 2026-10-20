import type { ChatMessageRecord } from '../messages/chat-message.types';
import { MessageType } from '../messages/message-type.enum';
import { SummaryLimitsService } from './summary-limits.service';

let nextId = 1;

function record(overrides: Partial<ChatMessageRecord>): ChatMessageRecord {
  const messageId = nextId;
  nextId += 1;
  return {
    chatId: -100,
    messageId,
    displayName: 'Іван',
    type: MessageType.Text,
    timestamp: new Date(messageId * 1000),
    metadata: {},
    ...overrides,
  };
}

describe('SummaryLimitsService', () => {
  const filter = { type: 'count' as const, value: 10 };

  function service(settings: Record<string, number> = {}): SummaryLimitsService {
    return new SummaryLimitsService({
      get: <T>(key: string, fallback: T) => (key in settings ? settings[key] : fallback),
    } as never);
  }

  it('formats every supported content type into the dialogue', () => {
    const messages = [
      record({ text: '  привіт  ' }),
      record({ type: MessageType.Voice, transcription: ' голос ', displayName: 'Олена' }),
      record({ type: MessageType.VideoNote, transcription: 'кружечок' }),
      record({ type: MessageType.Photo, text: 'підпис' }),
      record({ type: MessageType.Photo }),
      record({ type: MessageType.Document, metadata: { fileName: 'звіт.pdf' } }),
      record({ type: MessageType.Document, metadata: {} }),
      record({ type: MessageType.Other }),
    ];
    const result = service().apply(messages, filter, 'останні 10 повідомлень');

    expect(result.dialogText).toBe(
      [
        'Іван: привіт',
        'Олена: голос',
        'Іван: кружечок',
        'Іван: підпис',
        'Іван: [фото]',
        'Іван: [документ: звіт.pdf]',
        'Іван: [документ: документ]',
      ].join('\n\n'),
    );
    expect(result).toMatchObject({
      requestedCount: 8,
      analyzedCount: 8,
      periodLabel: 'останні 10 повідомлень',
      skippedVoiceCount: 0,
    });
    expect(result.messages).toHaveLength(8);
  });

  it('counts voice and video notes without a transcription as skipped', () => {
    const result = service().apply(
      [
        record({ type: MessageType.Voice }),
        record({ type: MessageType.VideoNote, transcription: '   ' }),
        record({ text: 'текст' }),
      ],
      filter,
      'p',
    );
    expect(result.skippedVoiceCount).toBe(2);
    expect(result.dialogText).toBe('Іван: текст');
  });

  it('keeps only the newest SUMMARY_MAX_MESSAGES messages', () => {
    const messages = [record({ text: 'a' }), record({ text: 'b' }), record({ text: 'c' })];
    const result = service({ SUMMARY_MAX_MESSAGES: 2 }).apply(messages, filter, 'p');
    expect(result.messages).toEqual(messages.slice(1));
    expect(result).toMatchObject({ requestedCount: 3, analyzedCount: 2, dialogText: 'Іван: b\n\nІван: c' });
  });

  it('drops the oldest messages until the dialogue fits SUMMARY_MAX_CHARACTERS and recounts skipped voices', () => {
    const messages = [
      record({ type: MessageType.Voice }),
      record({ text: 'x'.repeat(50) }),
      record({ type: MessageType.Voice }),
      record({ text: 'short' }),
    ];
    const result = service({ SUMMARY_MAX_CHARACTERS: 20 }).apply(messages, filter, 'p');
    expect(result.messages).toEqual(messages.slice(2));
    expect(result).toMatchObject({
      requestedCount: 4,
      analyzedCount: 2,
      dialogText: 'Іван: short',
      skippedVoiceCount: 1,
    });
  });

  it('keeps the last message even if it alone exceeds the character limit', () => {
    const result = service({ SUMMARY_MAX_CHARACTERS: 5 }).apply(
      [record({ text: 'дуже довге повідомлення' })],
      filter,
      'p',
    );
    expect(result.analyzedCount).toBe(1);
    expect(result.dialogText).toBe('Іван: дуже довге повідомлення');
  });
});
