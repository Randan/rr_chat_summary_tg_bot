import { GoogleGenAI } from '@google/genai';

import { SUMMARY_SYSTEM_PROMPT } from '../../config/summary.prompt';
import { GeminiQuotaError } from '../gemini-error.util';
import { GeminiProvider } from './gemini.provider';

jest.mock('@google/genai', () => ({ GoogleGenAI: jest.fn() }));

const input = {
  dialogue: 'Іван: привіт',
  periodLabel: 'останні 2 повідомлень',
  analyzedInfo: 'Проаналізовано 2 повідомлень.',
};

describe('GeminiProvider', () => {
  let generateContent: jest.Mock;
  let settings: Record<string, unknown>;
  let registry: { addDiagnostics: jest.Mock };
  let logger: { log: jest.Mock; error: jest.Mock };

  const config = { get: <T>(key: string, fallback?: T) => (key in settings ? settings[key] : fallback) };

  function createProvider(): GeminiProvider {
    return new GeminiProvider(config as never, registry as never, logger as never);
  }

  async function diagLines(): Promise<string[]> {
    const [, section] = registry.addDiagnostics.mock.calls[0];
    return section();
  }

  beforeEach(() => {
    generateContent = jest.fn();
    (GoogleGenAI as unknown as jest.Mock).mockImplementation(() => ({ models: { generateContent } }));
    settings = {
      GEMINI_API_KEY: 'key',
      GEMINI_MODEL: 'gemini-test',
      SUMMARY_MAX_TOKENS: 1024,
      GEMINI_TIMEOUT_MS: 5000,
    };
    registry = { addDiagnostics: jest.fn() };
    logger = { log: jest.fn(), error: jest.fn() };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('requires GEMINI_API_KEY', () => {
    delete settings.GEMINI_API_KEY;
    expect(() => createProvider()).toThrow('GEMINI_API_KEY is required when AI_PROVIDER=gemini');
  });

  it('creates the client with the API key', () => {
    createProvider();
    expect(GoogleGenAI).toHaveBeenCalledWith({ apiKey: 'key' });
  });

  it('returns the trimmed summary and sends the prompt with the system instruction', async () => {
    generateContent.mockResolvedValue({ text: '  підсумок  ' });
    await expect(createProvider().generateSummary(input)).resolves.toBe('підсумок');

    expect(generateContent).toHaveBeenCalledTimes(1);
    const [request] = generateContent.mock.calls[0];
    expect(request.model).toBe('gemini-test');
    expect(request.contents).toContain('Лог чату:\nІван: привіт');
    expect(request.config).toEqual({ systemInstruction: SUMMARY_SYSTEM_PROMPT, maxOutputTokens: 1024 });
  });

  it('requires GEMINI_MODEL at request time', async () => {
    delete settings.GEMINI_MODEL;
    await expect(createProvider().generateSummary(input)).rejects.toThrow(
      'GEMINI_MODEL is required when AI_PROVIDER=gemini',
    );
    expect(generateContent).not.toHaveBeenCalled();
  });

  it.each([[{ text: '   ' }], [{ text: undefined }]])('fails on an empty response %p', async response => {
    generateContent.mockResolvedValue(response);
    await expect(createProvider().generateSummary(input)).rejects.toThrow('Gemini returned empty summary');
    expect(logger.error).toHaveBeenCalledWith('Gemini summary request failed', {
      model: 'gemini-test',
      errorMessage: 'Gemini returned empty summary',
    });
  });

  it('maps a quota error to GeminiQuotaError and does not retry it', async () => {
    generateContent.mockRejectedValue(Object.assign(new Error('429 RESOURCE_EXHAUSTED'), { status: 429 }));
    const error = await createProvider()
      .generateSummary(input)
      .catch(err => err);
    expect(error).toBeInstanceOf(GeminiQuotaError);
    expect(error.message).toBe('429 RESOURCE_EXHAUSTED');
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('retries a transient network error once', async () => {
    jest.useFakeTimers();
    generateContent.mockRejectedValueOnce(new Error('fetch failed')).mockResolvedValueOnce({ text: 'вдалося' });
    const promise = createProvider().generateSummary(input);
    await jest.advanceTimersByTimeAsync(3000);
    await expect(promise).resolves.toBe('вдалося');
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-transient error', async () => {
    generateContent.mockRejectedValue(new Error('invalid argument'));
    await expect(createProvider().generateSummary(input)).rejects.toThrow('invalid argument');
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('gives up after GEMINI_TIMEOUT_MS on both attempts', async () => {
    jest.useFakeTimers();
    generateContent.mockReturnValue(new Promise(() => undefined));
    const promise = createProvider().generateSummary(input);
    const outcome = promise.catch(err => err);

    await jest.advanceTimersByTimeAsync(4999);
    expect(generateContent).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1 + 3000 + 5000);

    const error = await outcome;
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('TimeoutError');
    expect(error.message).toBe('no answer in 5s');
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it('uses the 90 s default timeout when GEMINI_TIMEOUT_MS is unset', async () => {
    jest.useFakeTimers();
    delete settings.GEMINI_TIMEOUT_MS;
    generateContent.mockReturnValueOnce(new Promise(() => undefined)).mockResolvedValueOnce({ text: 'ok' });
    const promise = createProvider().generateSummary(input);
    await jest.advanceTimersByTimeAsync(89_999);
    expect(generateContent).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1 + 3000);
    await expect(promise).resolves.toBe('ok');
  });

  it('registers the /diag section with the model, the last success and the last failure', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-20T10:15:00Z') });
    const provider = createProvider();
    provider.onModuleInit();
    expect(registry.addDiagnostics).toHaveBeenCalledWith('Gemini', expect.any(Function));
    expect(await diagLines()).toEqual(['модель: gemini-test', 'останній підсумок: —', 'остання помилка: —']);

    generateContent.mockResolvedValueOnce({ text: 'ok' }).mockRejectedValueOnce(new Error('bad request'));
    await provider.generateSummary(input);
    await provider.generateSummary(input).catch(() => undefined);

    expect(await diagLines()).toEqual([
      'модель: gemini-test',
      'останній підсумок: 20.10, 13:15',
      'остання помилка: 20.10, 13:15: bad request',
    ]);
  });

  it('shows a dash for an unset model in /diag', async () => {
    delete settings.GEMINI_MODEL;
    createProvider().onModuleInit();
    expect((await diagLines())[0]).toBe('модель: —');
  });
});
