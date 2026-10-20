import { splitTelegramMessage, TELEGRAM_MAX_MESSAGE_LENGTH } from './telegram-message.util';

describe('splitTelegramMessage', () => {
  it('keeps a short text as one part', () => {
    expect(splitTelegramMessage('hello')).toEqual(['hello']);
  });

  it('keeps a text of exactly the limit as one part', () => {
    const text = 'a'.repeat(TELEGRAM_MAX_MESSAGE_LENGTH);
    expect(splitTelegramMessage(text)).toEqual([text]);
  });

  it('splits at the last newline under 4096 and trims the leading whitespace of the rest', () => {
    const first = 'a'.repeat(4000);
    const second = 'b'.repeat(500);
    const parts = splitTelegramMessage(`${first}\n${second}`);
    expect(parts).toEqual([first, second]);
    parts.forEach(part => expect(part.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE_LENGTH));
  });

  it('hard-splits a text without newlines at the limit', () => {
    const text = 'x'.repeat(TELEGRAM_MAX_MESSAGE_LENGTH * 2 + 10);
    const parts = splitTelegramMessage(text);
    expect(parts.map(part => part.length)).toEqual([4096, 4096, 10]);
    expect(parts.join('')).toBe(text);
  });

  it('hard-splits when the only newline is at the very start', () => {
    const parts = splitTelegramMessage(`\n${'y'.repeat(20)}`, 10);
    expect(parts).toEqual(['\nyyyyyyyyy', 'yyyyyyyyyy', 'y']);
  });

  it('honours a custom limit', () => {
    expect(splitTelegramMessage('one\ntwo\nthree', 8)).toEqual(['one\ntwo', 'three']);
  });
});
