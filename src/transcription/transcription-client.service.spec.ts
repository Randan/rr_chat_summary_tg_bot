import { TranscriptionClientService } from './transcription-client.service';

function audioResponse(ok = true, status = 200) {
  return { ok, status, arrayBuffer: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer) };
}

function serviceResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: jest.fn().mockResolvedValue(body) };
}

describe('TranscriptionClientService', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;
  let settings: Record<string, unknown>;
  let getFile: jest.Mock;
  let service: TranscriptionClientService;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as never;
    settings = { BOT_TOKEN: '123:abc', TRANSCRIPTION_SERVICE_URL: 'http://svc:4205', TRANSCRIPTION_TIMEOUT_MS: 1000 };
    getFile = jest.fn().mockResolvedValue({ file_id: 'f1', file_path: 'voice/file_1.oga' });
    service = new TranscriptionClientService(
      { get: <T>(key: string, fallback?: T) => (key in settings ? settings[key] : fallback) } as never,
      { telegram: { getFile } } as never,
      { log: jest.fn(), error: jest.fn() } as never,
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it.each(['BOT_TOKEN', 'TRANSCRIPTION_SERVICE_URL'])('fails when %s is not configured', async key => {
    delete settings[key];
    await expect(service.transcribeTelegramFile('f1')).rejects.toThrow('Transcription client is not configured');
    expect(getFile).not.toHaveBeenCalled();
  });

  it('fails when Telegram gives no file path', async () => {
    getFile.mockResolvedValue({ file_id: 'f1' });
    await expect(service.transcribeTelegramFile('f1')).rejects.toThrow('Telegram file path missing');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('downloads the file and posts it to the transcription service without auth by default', async () => {
    fetchMock.mockResolvedValueOnce(audioResponse()).mockResolvedValueOnce(serviceResponse({ text: '  привіт  ' }));

    await expect(service.transcribeTelegramFile('f1', 'audio/mpeg')).resolves.toBe('привіт');

    expect(getFile).toHaveBeenCalledWith('f1');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.telegram.org/file/bot123:abc/voice/file_1.oga');
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('http://svc:4205/transcribe');
    expect(init.method).toBe('POST');
    expect(init.headers).toBeUndefined();
    const file = (init.body as FormData).get('file') as File;
    expect(file.name).toBe('audio.ogg');
    expect(file.type).toBe('audio/mpeg');
    expect(file.size).toBe(3);
  });

  it('sends the bearer token when TRANSCRIPTION_SERVICE_TOKEN is set and defaults the mime type', async () => {
    settings.TRANSCRIPTION_SERVICE_TOKEN = 'secret';
    fetchMock.mockResolvedValueOnce(audioResponse()).mockResolvedValueOnce(serviceResponse({ text: 'ok' }));
    await service.transcribeTelegramFile('f1');

    const init = fetchMock.mock.calls[1][1];
    expect(init.headers).toEqual({ Authorization: 'Bearer secret' });
    expect(((init.body as FormData).get('file') as File).type).toBe('audio/ogg');
  });

  it('returns an empty string when the service gives no text', async () => {
    fetchMock.mockResolvedValueOnce(audioResponse()).mockResolvedValueOnce(serviceResponse({}));
    await expect(service.transcribeTelegramFile('f1')).resolves.toBe('');
  });

  it('retries the download after a transient error', async () => {
    jest.useFakeTimers();
    fetchMock
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce(audioResponse())
      .mockResolvedValueOnce(serviceResponse({ text: 'ok' }));

    const promise = service.transcribeTelegramFile('f1');
    await jest.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries a download timeout and a 5xx, up to three attempts', async () => {
    jest.useFakeTimers();
    fetchMock
      .mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))
      .mockResolvedValueOnce(audioResponse(false, 502))
      .mockResolvedValueOnce(audioResponse(false, 503));

    const outcome = service.transcribeTelegramFile('f1').catch(err => err);
    await jest.advanceTimersByTimeAsync(1000 + 2000);
    const error = await outcome;
    expect(error.message).toBe('Failed to download audio: 503');
    expect(error.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry a 404 download', async () => {
    fetchMock.mockResolvedValueOnce(audioResponse(false, 404));
    await expect(service.transcribeTelegramFile('f1')).rejects.toThrow('Failed to download audio: 404');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails with the service error status', async () => {
    fetchMock.mockResolvedValueOnce(audioResponse()).mockResolvedValueOnce(serviceResponse({}, false, 500));
    await expect(service.transcribeTelegramFile('f1')).rejects.toThrow('Transcription service error: 500');
  });

  it('aborts the transcription request after TRANSCRIPTION_TIMEOUT_MS', async () => {
    jest.useFakeTimers();
    fetchMock.mockResolvedValueOnce(audioResponse()).mockImplementationOnce(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('This operation was aborted')));
        }),
    );

    const outcome = service.transcribeTelegramFile('f1').catch(err => err);
    await jest.advanceTimersByTimeAsync(1000);
    expect((await outcome).message).toBe('This operation was aborted');
  });
});
