import { Injectable } from '@nestjs/common';

@Injectable()
export class SummaryLockService {
  private readonly chains = new Map<number, Promise<unknown>>();

  async runExclusive<T>(chatId: number, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(chatId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const current = previous.then(() => gate);
    this.chains.set(chatId, current);

    await previous;

    try {
      return await task();
    } finally {
      release();
      if (this.chains.get(chatId) === current) {
        this.chains.delete(chatId);
      }
    }
  }
}
