import { GeminiQuotaError, mapGeminiError } from './gemini-error.util';

describe('GeminiQuotaError', () => {
  it('has a default message and its own name', () => {
    const error = new GeminiQuotaError();
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Gemini API quota exceeded');
    expect(error.name).toBe('GeminiQuotaError');
  });
});

describe('mapGeminiError', () => {
  it.each(['got 429 Too Many Requests', 'RESOURCE_EXHAUSTED', 'free tier quota hit', 'Quota exceeded for metric'])(
    'maps "%s" to a GeminiQuotaError',
    message => {
      const mapped = mapGeminiError(new Error(message));
      expect(mapped).toBeInstanceOf(GeminiQuotaError);
      expect(mapped.message).toBe(message);
    },
  );

  it('maps a quota string thrown as a non-Error too', () => {
    expect(mapGeminiError('429')).toBeInstanceOf(GeminiQuotaError);
  });

  it('returns any other Error unchanged', () => {
    const error = new Error('boom');
    expect(mapGeminiError(error)).toBe(error);
  });

  it('wraps a non-Error value into an Error', () => {
    const mapped = mapGeminiError('weird');
    expect(mapped).toBeInstanceOf(Error);
    expect(mapped).not.toBeInstanceOf(GeminiQuotaError);
    expect(mapped.message).toBe('weird');
  });
});
