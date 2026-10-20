import { MessageIngestHandler } from './message-ingest.handler';

describe('MessageIngestHandler', () => {
  let ingestService: { ingest: jest.Mock; ingestEdit: jest.Mock };
  let settings: Record<string, unknown>;
  let presence: { markPresent: jest.Mock };
  let logger: { log: jest.Mock; error: jest.Mock };
  let next: jest.Mock;
  let handler: MessageIngestHandler;

  beforeEach(() => {
    ingestService = {
      ingest: jest.fn().mockResolvedValue(undefined),
      ingestEdit: jest.fn().mockResolvedValue(undefined),
    };
    settings = { TRANSCRIPTION_BOT_USERNAME: 'voice_bot' };
    presence = { markPresent: jest.fn() };
    logger = { log: jest.fn(), error: jest.fn() };
    next = jest.fn().mockResolvedValue(undefined);
    handler = new MessageIngestHandler(
      ingestService as never,
      { get: (key: string) => settings[key] } as never,
      presence as never,
      logger as never,
    );
  });

  const chat = { id: -100, type: 'group' };

  describe('onMessage', () => {
    it('only calls next without a message', async () => {
      await handler.onMessage({ chat } as never, next);
      expect(ingestService.ingest).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('passes a bot command straight to next without storing it', async () => {
      const message = { message_id: 1, text: '/summary', entities: [{ type: 'bot_command', offset: 0, length: 8 }] };
      await handler.onMessage({ chat, message } as never, next);
      expect(ingestService.ingest).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('stores a regular message and calls next', async () => {
      const message = { message_id: 1, text: 'привіт', entities: [{ type: 'bold' }], from: { username: 'ivan' } };
      await handler.onMessage({ chat, message } as never, next);
      expect(ingestService.ingest).toHaveBeenCalledWith(message);
      expect(presence.markPresent).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('marks the transcription bot present when it writes in the chat', async () => {
      const message = { message_id: 2, text: '<blockquote>t</blockquote>', from: { username: 'voice_bot' } };
      await handler.onMessage({ chat, message } as never, next);
      expect(presence.markPresent).toHaveBeenCalledWith(-100);
    });

    it('does not mark presence without a configured transcription bot or a sender', async () => {
      delete settings.TRANSCRIPTION_BOT_USERNAME;
      await handler.onMessage({ chat, message: { message_id: 2, from: { username: 'voice_bot' } } } as never, next);
      settings.TRANSCRIPTION_BOT_USERNAME = 'voice_bot';
      await handler.onMessage({ chat, message: { message_id: 3 } } as never, next);
      await handler.onMessage({ message: { message_id: 4, from: { username: 'voice_bot' } } } as never, next);
      expect(presence.markPresent).not.toHaveBeenCalled();
    });

    it('swallows an ingest error, logs it and still calls next', async () => {
      ingestService.ingest.mockRejectedValue(new Error('db down'));
      await handler.onMessage({ chat, message: { message_id: 5, text: 'x' } } as never, next);
      expect(logger.error).toHaveBeenCalledWith('Failed to ingest message', {
        chatId: -100,
        messageId: 5,
        errorMessage: 'db down',
      });
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('logs a non-Error failure as unknown', async () => {
      ingestService.ingest.mockRejectedValue('weird');
      await handler.onMessage({ message: { message_id: 5, text: 'x' } } as never, next);
      expect(logger.error).toHaveBeenCalledWith('Failed to ingest message', {
        chatId: undefined,
        messageId: 5,
        errorMessage: 'Unknown error',
      });
    });
  });

  describe('onEditedMessage', () => {
    it('ignores an update without an edited message', async () => {
      await handler.onEditedMessage({ chat } as never);
      expect(ingestService.ingestEdit).not.toHaveBeenCalled();
    });

    it('ignores an edited bot command', async () => {
      const editedMessage = { message_id: 1, text: '/summary 5', entities: [{ type: 'bot_command' }] };
      await handler.onEditedMessage({ chat, editedMessage } as never);
      expect(ingestService.ingestEdit).not.toHaveBeenCalled();
    });

    it('stores the edit', async () => {
      const editedMessage = { message_id: 1, text: 'виправлено' };
      await handler.onEditedMessage({ chat, editedMessage } as never);
      expect(ingestService.ingestEdit).toHaveBeenCalledWith(editedMessage);
    });

    it('swallows and logs an edit failure', async () => {
      ingestService.ingestEdit.mockRejectedValueOnce(new Error('db down')).mockRejectedValueOnce(42);
      await handler.onEditedMessage({ chat, editedMessage: { message_id: 1, text: 'x' } } as never);
      await handler.onEditedMessage({ editedMessage: { message_id: 2, text: 'x' } } as never);
      expect(logger.error.mock.calls).toEqual([
        ['Failed to ingest edited message', { chatId: -100, messageId: 1, errorMessage: 'db down' }],
        ['Failed to ingest edited message', { chatId: undefined, messageId: 2, errorMessage: 'Unknown error' }],
      ]);
    });
  });
});
