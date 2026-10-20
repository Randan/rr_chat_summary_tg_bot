import { SummaryLockService } from './summary-lock.service';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

describe('SummaryLockService', () => {
  let lock: SummaryLockService;

  beforeEach(() => {
    lock = new SummaryLockService();
  });

  it('returns the task result', async () => {
    await expect(lock.runExclusive(1, async () => 'done')).resolves.toBe('done');
  });

  it('runs tasks of one chat one after another', async () => {
    const order: string[] = [];
    const first = deferred<string>();
    const second = jest.fn(async () => {
      order.push('second');
      return 'b';
    });

    const firstRun = lock.runExclusive(1, () => {
      order.push('first');
      return first.promise;
    });
    const secondRun = lock.runExclusive(1, second);

    await flush();
    expect(order).toEqual(['first']);
    expect(second).not.toHaveBeenCalled();

    first.resolve('a');
    await expect(firstRun).resolves.toBe('a');
    await expect(secondRun).resolves.toBe('b');
    expect(order).toEqual(['first', 'second']);
  });

  it('runs tasks of different chats in parallel', async () => {
    const first = deferred<void>();
    const other = jest.fn(async () => 'other');

    const firstRun = lock.runExclusive(1, () => first.promise);
    await expect(lock.runExclusive(2, other)).resolves.toBe('other');

    first.resolve();
    await firstRun;
  });

  it('releases the lock after a failing task', async () => {
    const failing = deferred<void>();
    const failingRun = lock.runExclusive(1, () => failing.promise);
    const next = lock.runExclusive(1, async () => 'next');

    failing.reject(new Error('boom'));
    await expect(failingRun).rejects.toThrow('boom');
    await expect(next).resolves.toBe('next');
    await expect(lock.runExclusive(1, async () => 'again')).resolves.toBe('again');
  });

  it('forgets the chat once its queue is empty', async () => {
    await lock.runExclusive(1, async () => undefined);
    expect((lock as unknown as { chains: Map<number, unknown> }).chains.size).toBe(0);
  });
});
