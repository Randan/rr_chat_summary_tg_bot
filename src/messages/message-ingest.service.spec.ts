import { MessageIngestService } from './message-ingest.service';
import { MessageType } from './message-type.enum';

const from = { id: 1, is_bot: false, first_name: 'Іван', last_name: 'Петренко', username: 'ivan' };

function message(extra: Record<string, unknown>) {
  return { message_id: 7, date: 1_760_000_000, chat: { id: -100, type: 'group' }, from, ...extra };
}

const base = {
  chatId: -100,
  messageId: 7,
  userId: 1,
  username: 'ivan',
  displayName: 'Іван Петренко',
  timestamp: new Date(1_760_000_000 * 1000),
  replyToMessageId: undefined,
  metadata: {},
};

describe('MessageIngestService', () => {
  let repository: { upsertMessage: jest.Mock; updateEditedMessage: jest.Mock; migrateChatId: jest.Mock };
  let logger: { log: jest.Mock; error: jest.Mock };
  let service: MessageIngestService;

  beforeEach(() => {
    repository = {
      upsertMessage: jest.fn().mockResolvedValue({}),
      updateEditedMessage: jest.fn().mockResolvedValue(undefined),
      migrateChatId: jest.fn().mockResolvedValue(12),
    };
    logger = { log: jest.fn(), error: jest.fn() };
    service = new MessageIngestService(repository as never, logger as never);
  });

  it('stores a text message', async () => {
    await service.ingest(message({ text: 'привіт' }) as never);
    expect(repository.upsertMessage).toHaveBeenCalledWith({ ...base, type: MessageType.Text, text: 'привіт' });
    expect(logger.log).toHaveBeenCalledWith('Message stored', { chatId: -100, messageId: 7, type: MessageType.Text });
  });

  it('stores a voice message with its file and metadata', async () => {
    await service.ingest(message({ voice: { file_id: 'v1', mime_type: 'audio/ogg', duration: 5 } }) as never);
    expect(repository.upsertMessage).toHaveBeenCalledWith({
      ...base,
      type: MessageType.Voice,
      telegramFileId: 'v1',
      metadata: { mimeType: 'audio/ogg', duration: 5 },
    });
  });

  it('stores a video note', async () => {
    await service.ingest(message({ video_note: { file_id: 'vn1', duration: 9, length: 240 } }) as never);
    expect(repository.upsertMessage).toHaveBeenCalledWith({
      ...base,
      type: MessageType.VideoNote,
      telegramFileId: 'vn1',
      metadata: { duration: 9, length: 240 },
    });
  });

  it('stores the largest photo size with the caption', async () => {
    await service.ingest(
      message({
        photo: [
          { file_id: 'small', file_size: 10 },
          { file_id: 'large', file_size: 99 },
        ],
        caption: 'захід сонця',
      }) as never,
    );
    expect(repository.upsertMessage).toHaveBeenCalledWith({
      ...base,
      type: MessageType.Photo,
      text: 'захід сонця',
      telegramFileId: 'large',
      metadata: { photoSize: 99 },
    });
  });

  it('stores a document', async () => {
    await service.ingest(
      message({ document: { file_id: 'd1', file_name: 'звіт.pdf', mime_type: 'application/pdf' } }) as never,
    );
    expect(repository.upsertMessage).toHaveBeenCalledWith({
      ...base,
      type: MessageType.Document,
      text: undefined,
      telegramFileId: 'd1',
      metadata: { fileName: 'звіт.pdf', mimeType: 'application/pdf' },
    });
  });

  it('stores any other captioned media as "other"', async () => {
    await service.ingest(message({ video: { file_id: 'x' }, caption: 'відео' }) as never);
    expect(repository.upsertMessage).toHaveBeenCalledWith({ ...base, type: MessageType.Other, text: 'відео' });
  });

  it('skips an unsupported message without a caption', async () => {
    await service.ingest(message({ sticker: { file_id: 's' } }) as never);
    expect(repository.upsertMessage).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith('Skipping unsupported message type', { chatId: -100, messageId: 7 });
  });

  it('skips a photo message with no sizes', async () => {
    await service.ingest(message({ photo: [] }) as never);
    expect(repository.upsertMessage).not.toHaveBeenCalled();
  });

  it('keeps the id of the replied-to message', async () => {
    await service.ingest(message({ text: 'так', reply_to_message: { message_id: 3 } }) as never);
    expect(repository.upsertMessage.mock.calls[0][0].replyToMessageId).toBe(3);
  });

  it.each([
    [{ ...from, last_name: undefined }, 'Іван'],
    [{ id: 2, is_bot: false, first_name: '', username: 'anon' }, 'anon'],
    [{ id: 3, is_bot: false, first_name: '' }, 'Невідомий'],
    [undefined, 'Невідомий'],
  ])('builds the display name from %p', async (sender, displayName) => {
    await service.ingest(message({ text: 'x', from: sender }) as never);
    expect(repository.upsertMessage.mock.calls[0][0].displayName).toBe(displayName);
  });

  it.each(['new_chat_members', 'left_chat_member', 'pinned_message', 'migrate_from_chat_id', 'video_chat_started'])(
    'skips the service message %s',
    async key => {
      await service.ingest(message({ [key]: {} }) as never);
      expect(repository.upsertMessage).not.toHaveBeenCalled();
      expect(logger.log).toHaveBeenCalledWith('Skipping service message', { chatId: -100, messageId: 7 });
    },
  );

  it('moves the stored messages when the group migrates to a supergroup', async () => {
    await service.ingest(message({ migrate_to_chat_id: -1001 }) as never);
    expect(repository.migrateChatId).toHaveBeenCalledWith(-100, -1001);
    expect(repository.upsertMessage).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith('Migrated chat messages to supergroup', {
      fromChatId: -100,
      toChatId: -1001,
      migratedCount: 12,
    });
  });

  it('stores an edit of a supported message', async () => {
    await service.ingestEdit(message({ text: 'виправлено' }) as never);
    expect(repository.updateEditedMessage).toHaveBeenCalledWith({
      ...base,
      type: MessageType.Text,
      text: 'виправлено',
    });
    expect(logger.log).toHaveBeenCalledWith('Message edit stored', {
      chatId: -100,
      messageId: 7,
      type: MessageType.Text,
    });
  });

  it('ignores an edit of an unsupported message', async () => {
    await service.ingestEdit(message({ location: {} }) as never);
    expect(repository.updateEditedMessage).not.toHaveBeenCalled();
  });
});
