import type { Context } from 'telegraf';

import { extractCommandNumericArgument } from './command-argument.util';

function ctxWith(message: unknown): Context {
  return { message } as never;
}

function commandMessage(text: string, commandLength: number, offset = 0) {
  return { text, entities: [{ type: 'bot_command', offset, length: commandLength }] };
}

describe('extractCommandNumericArgument', () => {
  it('returns undefined without a message', () => {
    expect(extractCommandNumericArgument(ctxWith(undefined))).toBeUndefined();
  });

  it('returns undefined for a message without text', () => {
    expect(extractCommandNumericArgument(ctxWith({ voice: {} }))).toBeUndefined();
  });

  it('reads the number after the bot_command entity', () => {
    expect(extractCommandNumericArgument(ctxWith(commandMessage('/summary 30', 8)))).toBe(30);
  });

  it('reads the number after a command with the bot username', () => {
    expect(extractCommandNumericArgument(ctxWith(commandMessage('/summary_h@my_bot 5 extra', 17)))).toBe(5);
  });

  it('returns undefined when the command has no argument', () => {
    expect(extractCommandNumericArgument(ctxWith(commandMessage('/summary   ', 8)))).toBeUndefined();
  });

  it('returns undefined for a non-numeric argument after the entity', () => {
    expect(extractCommandNumericArgument(ctxWith(commandMessage('/summary abc', 8)))).toBeUndefined();
  });

  it('keeps a negative or fractional number for the caller to validate', () => {
    expect(extractCommandNumericArgument(ctxWith(commandMessage('/summary -3', 8)))).toBe(-3);
    expect(extractCommandNumericArgument(ctxWith(commandMessage('/summary 2.5', 8)))).toBe(2.5);
  });

  it('falls back to the second word when there is no bot_command entity', () => {
    expect(extractCommandNumericArgument(ctxWith({ text: '/summary 12', entities: [{ type: 'bold' }] }))).toBe(12);
    expect(extractCommandNumericArgument(ctxWith({ text: '/summary 12' }))).toBe(12);
  });

  it('returns undefined in the fallback for a single word or a non-number', () => {
    expect(extractCommandNumericArgument(ctxWith({ text: '/summary' }))).toBeUndefined();
    expect(extractCommandNumericArgument(ctxWith({ text: '/summary many' }))).toBeUndefined();
  });
});
