import type { ChatMessageRecord } from '../messages/chat-message.types';
import { MessageType } from '../messages/message-type.enum';
import { TranscriptionResolverService } from './transcription-resolver.service';

function record(messageId: number, overrides: Partial<ChatMessageRecord> = {}): ChatMessageRecord {
  return {
    chatId: -100,
    messageId,
    displayName: 'Іван',
    type: MessageType.Voice,
    telegramFileId: `file-${messageId}`,
    timestamp: new Date(messageId * 1000),
    metadata: { mimeType: 'audio/ogg' },
    ...overrides,
  };
}

describe('TranscriptionResolverService', () => {
  let settings: Record<string, unknown>;
  let repository: { findTranscriptionReplies: jest.Mock; saveTranscription: jest.Mock };
  let client: { transcribeTelegramFile: jest.Mock };
  let presence: { isTranscriptionBotPresent: jest.Mock };
  let logger: { log: jest.Mock; error: jest.Mock };
  let service: TranscriptionResolverService;

  beforeEach(() => {
    settings = { TRANSCRIPTION_BOT_USERNAME: 'voice_bot' };
    repository = {
      findTranscriptionReplies: jest.fn().mockResolvedValue([]),
      saveTranscription: jest.fn().mockResolvedValue(undefined),
    };
    client = { transcribeTelegramFile: jest.fn().mockResolvedValue('з http') };
    presence = { isTranscriptionBotPresent: jest.fn().mockResolvedValue(false) };
    logger = { log: jest.fn(), error: jest.fn() };
    service = new TranscriptionResolverService(
      { get: <T>(key: string, fallback?: T) => (key in settings ? settings[key] : fallback) } as never,
      repository as never,
      client as never,
      presence as never,
      logger as never,
    );
  });

  it('returns an empty list for no messages', async () => {
    await expect(service.resolveTranscriptions([])).resolves.toEqual([]);
    expect(presence.isTranscriptionBotPresent).not.toHaveBeenCalled();
  });

  it('leaves non-voice and already transcribed messages untouched', async () => {
    const text = record(1, { type: MessageType.Text, text: 'привіт' });
    const done = record(2, { transcription: 'вже є' });
    const result = await service.resolveTranscriptions([text, done]);
    expect(result).toEqual([text, done]);
    expect(client.transcribeTelegramFile).not.toHaveBeenCalled();
    expect(repository.saveTranscription).not.toHaveBeenCalled();
  });

  it('uses the transcription bot reply when the bot is present', async () => {
    presence.isTranscriptionBotPresent.mockResolvedValue(true);
    repository.findTranscriptionReplies.mockResolvedValue([
      record(11, { type: MessageType.Text, text: '<blockquote>перша</blockquote>' }),
      record(12, { type: MessageType.Text, text: undefined }),
      record(13, { type: MessageType.Text, text: '<blockquote>друга</blockquote>' }),
    ]);
    const voice = record(10, { type: MessageType.VideoNote });

    const [result] = await service.resolveTranscriptions([voice]);

    expect(presence.isTranscriptionBotPresent).toHaveBeenCalledWith(-100);
    expect(repository.findTranscriptionReplies).toHaveBeenCalledWith(-100, 10, 'voice_bot');
    expect(result).toEqual({ ...voice, transcription: 'перша\n\nдруга' });
    expect(repository.saveTranscription).toHaveBeenCalledWith(-100, 10, 'перша\n\nдруга');
    expect(client.transcribeTelegramFile).not.toHaveBeenCalled();
  });

  it('falls back to HTTP when the present bot has not replied', async () => {
    presence.isTranscriptionBotPresent.mockResolvedValue(true);
    const voice = record(10);
    const [result] = await service.resolveTranscriptions([voice]);

    expect(logger.log).toHaveBeenCalledWith('Transcription bot present but reply not found, falling back to HTTP', {
      chatId: -100,
      messageId: 10,
    });
    expect(client.transcribeTelegramFile).toHaveBeenCalledWith('file-10', 'audio/ogg');
    expect(result.transcription).toBe('з http');
  });

  it('goes straight to HTTP without a configured bot username', async () => {
    presence.isTranscriptionBotPresent.mockResolvedValue(true);
    delete settings.TRANSCRIPTION_BOT_USERNAME;
    await service.resolveTranscriptions([record(10, { metadata: {} })]);
    expect(repository.findTranscriptionReplies).not.toHaveBeenCalled();
    expect(client.transcribeTelegramFile).toHaveBeenCalledWith('file-10', undefined);
    expect(repository.saveTranscription).toHaveBeenCalledWith(-100, 10, 'з http');
  });

  it('leaves a voice message without a file id untranscribed', async () => {
    const voice = record(10, { telegramFileId: undefined });
    await expect(service.resolveTranscriptions([voice])).resolves.toEqual([voice]);
    expect(client.transcribeTelegramFile).not.toHaveBeenCalled();
  });

  it('does not save an empty HTTP transcription', async () => {
    client.transcribeTelegramFile.mockResolvedValue('');
    const voice = record(10);
    await expect(service.resolveTranscriptions([voice])).resolves.toEqual([voice]);
    expect(repository.saveTranscription).not.toHaveBeenCalled();
  });

  it('returns a failing voice message without a transcription instead of rejecting the batch', async () => {
    client.transcribeTelegramFile
      .mockRejectedValueOnce(new Error('service down'))
      .mockRejectedValueOnce('weird')
      .mockResolvedValueOnce('третя');
    const messages = [record(1), record(2), record(3)];

    const result = await service.resolveTranscriptions(messages);

    expect(result).toEqual([messages[0], messages[1], { ...messages[2], transcription: 'третя' }]);
    expect(logger.error.mock.calls).toEqual([
      ['Transcription failed, leaving the message out', { chatId: -100, messageId: 1, errorMessage: 'service down' }],
      ['Transcription failed, leaving the message out', { chatId: -100, messageId: 2, errorMessage: 'weird' }],
    ]);
    expect(repository.saveTranscription).toHaveBeenCalledTimes(1);
  });

  it('runs at most TRANSCRIPTION_CONCURRENCY transcriptions at once', async () => {
    settings.TRANSCRIPTION_CONCURRENCY = 2;
    let active = 0;
    let peak = 0;
    client.transcribeTelegramFile.mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(resolve => setImmediate(resolve));
      active -= 1;
      return 'ok';
    });
    await service.resolveTranscriptions([record(1), record(2), record(3), record(4), record(5)]);
    expect(peak).toBe(2);
    expect(client.transcribeTelegramFile).toHaveBeenCalledTimes(5);
  });
});
