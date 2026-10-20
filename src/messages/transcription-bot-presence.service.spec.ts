import { TranscriptionBotPresenceService } from './transcription-bot-presence.service';

const TTL_MS = 5 * 60 * 1000;

describe('TranscriptionBotPresenceService', () => {
  let settings: Record<string, unknown>;
  let getChatMember: jest.Mock;
  let repository: { hasTranscriptionBotMessages: jest.Mock };
  let logger: { log: jest.Mock; error: jest.Mock };
  let service: TranscriptionBotPresenceService;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-20T10:00:00Z') });
    settings = { TRANSCRIPTION_BOT_USERNAME: 'voice_bot' };
    getChatMember = jest.fn().mockResolvedValue({ status: 'member' });
    repository = { hasTranscriptionBotMessages: jest.fn().mockResolvedValue(true) };
    logger = { log: jest.fn(), error: jest.fn() };
    service = new TranscriptionBotPresenceService(
      { get: (key: string) => settings[key] } as never,
      { telegram: { getChatMember } } as never,
      repository as never,
      logger as never,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('is absent when no transcription bot is configured', async () => {
    delete settings.TRANSCRIPTION_BOT_USERNAME;
    await expect(service.isTranscriptionBotPresent(-100)).resolves.toBe(false);
    expect(repository.hasTranscriptionBotMessages).not.toHaveBeenCalled();
  });

  it('falls back to the message history without a bot user id', async () => {
    await expect(service.isTranscriptionBotPresent(-100)).resolves.toBe(true);
    expect(repository.hasTranscriptionBotMessages).toHaveBeenCalledWith(-100, 'voice_bot');
    expect(getChatMember).not.toHaveBeenCalled();
  });

  it('caches the answer for five minutes per chat', async () => {
    repository.hasTranscriptionBotMessages.mockResolvedValueOnce(false).mockResolvedValue(true);
    await expect(service.isTranscriptionBotPresent(-100)).resolves.toBe(false);

    jest.advanceTimersByTime(TTL_MS - 1);
    await expect(service.isTranscriptionBotPresent(-100)).resolves.toBe(false);
    expect(repository.hasTranscriptionBotMessages).toHaveBeenCalledTimes(1);

    await service.isTranscriptionBotPresent(-200);
    expect(repository.hasTranscriptionBotMessages).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(1);
    await expect(service.isTranscriptionBotPresent(-100)).resolves.toBe(true);
    expect(repository.hasTranscriptionBotMessages).toHaveBeenCalledTimes(3);
  });

  it('is present after markPresent without any lookup', async () => {
    service.markPresent(-100);
    await expect(service.isTranscriptionBotPresent(-100)).resolves.toBe(true);
    expect(repository.hasTranscriptionBotMessages).not.toHaveBeenCalled();
  });

  it.each([
    ['member', true],
    ['administrator', true],
    ['left', false],
    ['kicked', false],
  ])('asks getChatMember when the bot user id is set (status %s)', async (status, expected) => {
    settings.TRANSCRIPTION_BOT_USER_ID = 777;
    getChatMember.mockResolvedValue({ status });
    await expect(service.isTranscriptionBotPresent(-100)).resolves.toBe(expected);
    expect(getChatMember).toHaveBeenCalledWith(-100, 777);
    expect(repository.hasTranscriptionBotMessages).not.toHaveBeenCalled();
  });

  it('treats a getChatMember failure as absent and caches it', async () => {
    settings.TRANSCRIPTION_BOT_USER_ID = 777;
    getChatMember.mockRejectedValueOnce(new Error('chat not found')).mockRejectedValueOnce('weird');
    await expect(service.isTranscriptionBotPresent(-100)).resolves.toBe(false);
    await expect(service.isTranscriptionBotPresent(-100)).resolves.toBe(false);
    expect(getChatMember).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith('Could not resolve transcription bot via getChatMember', {
      chatId: -100,
      errorMessage: 'chat not found',
    });

    await service.isTranscriptionBotPresent(-200);
    expect(logger.log).toHaveBeenLastCalledWith('Could not resolve transcription bot via getChatMember', {
      chatId: -200,
      errorMessage: 'Unknown error',
    });
  });
});
