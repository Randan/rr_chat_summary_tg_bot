import { MessageRepository } from './message.repository';
import { MessageType } from './message-type.enum';

interface Query {
  sort: jest.Mock;
  limit: jest.Mock;
  select: jest.Mock;
  lean: jest.Mock;
  exec: jest.Mock;
}

/** A mongoose query whose chain methods return itself and whose exec resolves the canned result. */
function query(result: unknown): Query {
  const chain = {} as Query;
  chain.sort = jest.fn(() => chain);
  chain.limit = jest.fn(() => chain);
  chain.select = jest.fn(() => chain);
  chain.lean = jest.fn(() => chain);
  chain.exec = jest.fn().mockResolvedValue(result);
  return chain;
}

function ids(count: number, from = 0) {
  return Array.from({ length: count }, (_, index) => ({ _id: `id${from + index}` }));
}

describe('MessageRepository', () => {
  let model: {
    db: { readyState: number };
    findOneAndUpdate: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    updateOne: jest.Mock;
    updateMany: jest.Mock;
    countDocuments: jest.Mock;
    deleteMany: jest.Mock;
    distinct: jest.Mock;
  };
  let registry: { addHealthCheck: jest.Mock };
  let repository: MessageRepository;

  const input = {
    chatId: -100,
    messageId: 7,
    userId: 1,
    username: 'ivan',
    displayName: 'Іван Петренко',
    type: MessageType.Voice,
    text: undefined,
    telegramFileId: 'file-1',
    timestamp: new Date('2026-10-20T10:00:00Z'),
    replyToMessageId: 3,
    metadata: { mimeType: 'audio/ogg' },
  };

  beforeEach(() => {
    model = {
      db: { readyState: 1 },
      findOneAndUpdate: jest.fn(() => query({ saved: true })),
      find: jest.fn(),
      findOne: jest.fn(),
      updateOne: jest.fn(() => query({})),
      updateMany: jest.fn(() => query({ modifiedCount: 4 })),
      countDocuments: jest.fn(),
      deleteMany: jest.fn((filter: { _id: { $in: unknown[] } }) => query({ deletedCount: filter._id.$in.length })),
      distinct: jest.fn(),
    };
    registry = { addHealthCheck: jest.fn() };
    repository = new MessageRepository(model as never, registry as never);
  });

  it('registers a MongoDB health check that follows the connection state', async () => {
    repository.onModuleInit();
    const [name, check] = registry.addHealthCheck.mock.calls[0];
    expect(name).toBe('MongoDB');
    expect(check()).toEqual({ ok: true, details: 'readyState 1' });
    model.db.readyState = 0;
    expect(check()).toEqual({ ok: false, details: 'readyState 0' });
  });

  it('upserts a message by chat and message id without overwriting an existing one', async () => {
    await expect(repository.upsertMessage(input)).resolves.toEqual({ saved: true });
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { chatId: -100, messageId: 7 },
      {
        $setOnInsert: {
          chatId: -100,
          messageId: 7,
          userId: 1,
          username: 'ivan',
          displayName: 'Іван Петренко',
          type: MessageType.Voice,
          text: undefined,
          telegramFileId: 'file-1',
          timestamp: input.timestamp,
          replyToMessageId: 3,
          metadata: { mimeType: 'audio/ogg' },
        },
      },
      { upsert: true, new: true },
    );
  });

  it('stores empty metadata when none is given', async () => {
    await repository.upsertMessage({ ...input, metadata: undefined });
    expect(model.findOneAndUpdate.mock.calls[0][1].$setOnInsert.metadata).toEqual({});
  });

  it('returns the latest N messages in chronological order', async () => {
    const latest = query([{ messageId: 3 }, { messageId: 2 }, { messageId: 1 }]);
    model.find.mockReturnValue(latest);
    await expect(repository.findLatestByCount(-100, 3)).resolves.toEqual([
      { messageId: 1 },
      { messageId: 2 },
      { messageId: 3 },
    ]);
    expect(model.find).toHaveBeenCalledWith({ chatId: -100 });
    expect(latest.sort).toHaveBeenCalledWith({ timestamp: -1, messageId: -1 });
    expect(latest.limit).toHaveBeenCalledWith(3);
  });

  it('returns the messages since a date in chronological order', async () => {
    const since = new Date('2026-10-20T00:00:00Z');
    const found = query([{ messageId: 1 }]);
    model.find.mockReturnValue(found);
    await expect(repository.findSince(-100, since)).resolves.toEqual([{ messageId: 1 }]);
    expect(model.find).toHaveBeenCalledWith({ chatId: -100, timestamp: { $gte: since } });
    expect(found.sort).toHaveBeenCalledWith({ timestamp: 1, messageId: 1 });
  });

  describe('findTranscriptionReplies', () => {
    const firstReply = { messageId: 10, replyToMessageId: 7, timestamp: new Date('2026-10-20T10:00:00Z'), text: 'a' };

    it('returns nothing when the bot did not reply', async () => {
      model.findOne.mockReturnValue(query(null));
      await expect(repository.findTranscriptionReplies(-100, 7, 'voice_bot')).resolves.toEqual([]);
      expect(model.findOne).toHaveBeenCalledWith({
        chatId: -100,
        replyToMessageId: 7,
        username: 'voice_bot',
        type: 'text',
      });
      expect(model.find).not.toHaveBeenCalled();
    });

    it('collects the continuation chunks and stops at a reply to another message', async () => {
      model.findOne.mockReturnValue(query(firstReply));
      const continuation = query([
        { messageId: 11, text: 'b' },
        { messageId: 12, replyToMessageId: 7, text: 'c' },
        { messageId: 13, replyToMessageId: 99, text: 'other voice' },
        { messageId: 14, text: 'after' },
      ]);
      model.find.mockReturnValue(continuation);

      const replies = await repository.findTranscriptionReplies(-100, 7, 'voice_bot');

      expect(replies.map(reply => reply.messageId)).toEqual([10, 11, 12]);
      expect(model.find).toHaveBeenCalledWith({
        chatId: -100,
        username: 'voice_bot',
        type: 'text',
        messageId: { $gt: 10 },
        timestamp: { $lte: new Date('2026-10-20T10:02:00Z') },
      });
      expect(continuation.sort).toHaveBeenCalledWith({ messageId: 1 });
    });
  });

  it.each([
    [{ _id: 'x' }, true],
    [null, false],
  ])('tells whether the transcription bot has messages (%p)', async (doc, expected) => {
    model.findOne.mockReturnValue(query(doc));
    await expect(repository.hasTranscriptionBotMessages(-100, 'voice_bot')).resolves.toBe(expected);
    expect(model.findOne).toHaveBeenCalledWith({ chatId: -100, username: 'voice_bot' });
  });

  it('saves a transcription', async () => {
    await repository.saveTranscription(-100, 7, 'текст');
    expect(model.updateOne).toHaveBeenCalledWith({ chatId: -100, messageId: 7 }, { $set: { transcription: 'текст' } });
  });

  it('moves the messages of a migrated group to the supergroup id', async () => {
    await expect(repository.migrateChatId(-1, -1001)).resolves.toBe(4);
    expect(model.updateMany).toHaveBeenCalledWith({ chatId: -1 }, { $set: { chatId: -1001 } });
  });

  it('updates the editable fields of an edited message and inserts it when missing', async () => {
    await repository.updateEditedMessage({ ...input, text: 'нове', metadata: undefined });
    expect(model.updateOne).toHaveBeenCalledWith(
      { chatId: -100, messageId: 7 },
      {
        $set: { text: 'нове', displayName: 'Іван Петренко', username: 'ivan', metadata: {} },
        $setOnInsert: {
          chatId: -100,
          messageId: 7,
          userId: 1,
          type: MessageType.Voice,
          telegramFileId: 'file-1',
          timestamp: input.timestamp,
          replyToMessageId: 3,
        },
      },
      { upsert: true },
    );
  });

  it('counts all documents', async () => {
    model.countDocuments.mockReturnValue(query(123));
    await expect(repository.countAll()).resolves.toBe(123);
  });

  describe('deleteOlderThan', () => {
    const cutoff = new Date('2026-09-20T00:00:00Z');

    it('deletes in batches until a batch is short', async () => {
      model.find
        .mockReturnValueOnce(query(ids(2)))
        .mockReturnValueOnce(query(ids(2, 2)))
        .mockReturnValueOnce(query(ids(1, 4)));
      await expect(repository.deleteOlderThan(cutoff, 2)).resolves.toBe(5);
      expect(model.find).toHaveBeenCalledWith({ timestamp: { $lt: cutoff } });
      expect(model.deleteMany).toHaveBeenCalledTimes(3);
      expect(model.deleteMany).toHaveBeenNthCalledWith(1, { _id: { $in: ['id0', 'id1'] } });
    });

    it('stops when nothing is stale', async () => {
      model.find.mockReturnValueOnce(query(ids(2))).mockReturnValueOnce(query([]));
      await expect(repository.deleteOlderThan(cutoff, 2)).resolves.toBe(2);
      expect(model.deleteMany).toHaveBeenCalledTimes(1);
    });

    it('treats a missing deletedCount as zero', async () => {
      model.find.mockReturnValueOnce(query(ids(1)));
      model.deleteMany.mockReturnValueOnce(query({}));
      await expect(repository.deleteOlderThan(cutoff, 2)).resolves.toBe(0);
    });
  });

  describe('trimToMaxTotal', () => {
    it('does nothing under the cap', async () => {
      model.countDocuments.mockReturnValue(query(10));
      await expect(repository.trimToMaxTotal(10, 5)).resolves.toBe(0);
      expect(model.find).not.toHaveBeenCalled();
    });

    it('deletes the oldest documents in batches of at most batchSize', async () => {
      model.countDocuments.mockReturnValueOnce(query(17)).mockReturnValueOnce(query(12)).mockReturnValueOnce(query(10));
      const first = query(ids(5));
      const second = query(ids(2, 5));
      model.find.mockReturnValueOnce(first).mockReturnValueOnce(second);

      await expect(repository.trimToMaxTotal(10, 5)).resolves.toBe(7);
      expect(model.find).toHaveBeenCalledWith({});
      expect(first.limit).toHaveBeenCalledWith(5);
      expect(second.limit).toHaveBeenCalledWith(2);
    });

    it('stops when no documents are returned or a batch is short', async () => {
      model.countDocuments.mockReturnValue(query(20));
      model.find.mockReturnValueOnce(query([]));
      await expect(repository.trimToMaxTotal(10, 5)).resolves.toBe(0);

      model.find.mockReturnValueOnce(query(ids(3)));
      await expect(repository.trimToMaxTotal(10, 5)).resolves.toBe(3);
    });
  });

  describe('trimChatsOverLimit', () => {
    it('trims every chat to the per-chat limit', async () => {
      model.distinct.mockReturnValue(query([-1, -2]));
      model.countDocuments
        .mockReturnValueOnce(query(3)) // chat -1 under the limit
        .mockReturnValueOnce(query(9)) // chat -2: 5 over
        .mockReturnValueOnce(query(6)) // chat -2: 2 over
        .mockReturnValueOnce(query(4));
      const first = query(ids(3));
      model.find.mockReturnValueOnce(first).mockReturnValueOnce(query(ids(2, 3)));

      await expect(repository.trimChatsOverLimit(4, 3)).resolves.toBe(5);
      expect(model.distinct).toHaveBeenCalledWith('chatId');
      expect(model.countDocuments).toHaveBeenCalledWith({ chatId: -1 });
      expect(model.find).toHaveBeenCalledWith({ chatId: -2 });
      expect(first.limit).toHaveBeenCalledWith(3);
    });

    it('stops a chat when no documents are returned or a batch is short', async () => {
      model.distinct.mockReturnValue(query([-1, -2]));
      model.countDocuments.mockReturnValue(query(10));
      model.find.mockReturnValueOnce(query([])).mockReturnValueOnce(query(ids(1)));
      model.deleteMany.mockReturnValueOnce(query({}));
      await expect(repository.trimChatsOverLimit(4, 3)).resolves.toBe(0);
      expect(model.deleteMany).toHaveBeenCalledTimes(1);
    });
  });
});
