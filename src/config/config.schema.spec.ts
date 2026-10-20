import { configValidationSchema } from './config.schema';

const env = {
  BOT_TOKEN: 't',
  DB_URL: 'mongodb://localhost/chat',
  GEMINI_API_KEY: 'key',
  GEMINI_MODEL: 'gemini-2.5-flash',
  SUMMARY_DEFAULT_MESSAGE_COUNT: '50',
  SUMMARY_DEFAULT_MINUTES: '60',
  SUMMARY_DEFAULT_HOURS: '12',
  SUMMARY_DEFAULT_DAYS: '7',
  SUMMARY_MAX_MESSAGES: '500',
  SUMMARY_MAX_CHARACTERS: '50000',
  SUMMARY_MAX_TOKENS: '4096',
  TRANSCRIPTION_SERVICE_URL: 'http://host.docker.internal:4205',
};

describe('configValidationSchema', () => {
  it('fills in the defaults for optional keys', () => {
    expect(configValidationSchema(env)).toEqual({
      BOT_TOKEN: 't',
      PORT: 3000,
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
      ADMIN_TELEGRAM_ID: undefined,
      DB_URL: 'mongodb://localhost/chat?retryWrites=true&w=majority',
      DB_MESSAGES_COLLECTION: 'chat_messages',
      AI_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'key',
      GEMINI_MODEL: 'gemini-2.5-flash',
      GEMINI_TIMEOUT_MS: 90_000,
      SUMMARY_DEFAULT_MESSAGE_COUNT: 50,
      SUMMARY_DEFAULT_MINUTES: 60,
      SUMMARY_DEFAULT_HOURS: 12,
      SUMMARY_DEFAULT_DAYS: 7,
      SUMMARY_MAX_MESSAGES: 500,
      SUMMARY_MAX_CHARACTERS: 50000,
      SUMMARY_MAX_TOKENS: 4096,
      TRANSCRIPTION_BOT_USERNAME: undefined,
      TRANSCRIPTION_BOT_USER_ID: undefined,
      TRANSCRIPTION_SERVICE_URL: 'http://host.docker.internal:4205',
      TRANSCRIPTION_SERVICE_TOKEN: undefined,
      TRANSCRIPTION_TIMEOUT_MS: 120_000,
      TRANSCRIPTION_CONCURRENCY: 3,
      MESSAGE_RETENTION_DAYS: 30,
      MESSAGE_MAX_TOTAL_DOCUMENTS: 80_000,
      MESSAGE_MAX_MESSAGES_PER_CHAT: 10_000,
      MESSAGE_CLEANUP_BATCH_SIZE: 500,
      MESSAGE_CLEANUP_CRON: undefined,
      TIMEZONE: 'Europe/Kyiv',
    });
  });

  it('reads the explicitly set optional keys', () => {
    const config = configValidationSchema({
      ...env,
      PORT: '4206',
      NODE_ENV: 'development',
      LOG_LEVEL: 'silent',
      ADMIN_TELEGRAM_ID: '42',
      DB_MESSAGES_COLLECTION: 'messages',
      GEMINI_TIMEOUT_MS: '1000',
      TRANSCRIPTION_BOT_USER_ID: '777',
      TRANSCRIPTION_SERVICE_TOKEN: 'secret',
      MESSAGE_MAX_TOTAL_DOCUMENTS: '0',
      MESSAGE_CLEANUP_CRON: '0 4 * * *',
      TIMEZONE: 'UTC',
    });
    expect(config).toMatchObject({
      PORT: 4206,
      NODE_ENV: 'development',
      LOG_LEVEL: 'silent',
      ADMIN_TELEGRAM_ID: '42',
      DB_MESSAGES_COLLECTION: 'messages',
      GEMINI_TIMEOUT_MS: 1000,
      TRANSCRIPTION_BOT_USER_ID: 777,
      TRANSCRIPTION_SERVICE_TOKEN: 'secret',
      MESSAGE_MAX_TOTAL_DOCUMENTS: 0,
      MESSAGE_CLEANUP_CRON: '0 4 * * *',
      TIMEZONE: 'UTC',
    });
  });

  it.each([
    'BOT_TOKEN',
    'DB_URL',
    'GEMINI_API_KEY',
    'GEMINI_MODEL',
    'SUMMARY_DEFAULT_MESSAGE_COUNT',
    'SUMMARY_DEFAULT_MINUTES',
    'SUMMARY_DEFAULT_HOURS',
    'SUMMARY_DEFAULT_DAYS',
    'SUMMARY_MAX_MESSAGES',
    'SUMMARY_MAX_CHARACTERS',
    'SUMMARY_MAX_TOKENS',
    'TRANSCRIPTION_SERVICE_URL',
  ])('requires %s', key => {
    const { [key as keyof typeof env]: _removed, ...rest } = env;
    expect(() => configValidationSchema(rest)).toThrow(`Missing required env: ${key}`);
  });

  it('accepts TELEGRAM_BOT_TOKEN as an alias of BOT_TOKEN', () => {
    const { BOT_TOKEN: _token, ...rest } = env;
    expect(configValidationSchema({ ...rest, TELEGRAM_BOT_TOKEN: 'alias' }).BOT_TOKEN).toBe('alias');
  });

  it('prefers TELEGRAM_BOT_TOKEN over BOT_TOKEN', () => {
    expect(configValidationSchema({ ...env, TELEGRAM_BOT_TOKEN: 'alias' }).BOT_TOKEN).toBe('alias');
  });

  it('accepts MONGODB_URI as an alias of DB_URL and encodes its password', () => {
    const { DB_URL: _url, ...rest } = env;
    expect(configValidationSchema({ ...rest, MONGODB_URI: 'mongodb+srv://u:p@ss@c.net/db' }).DB_URL).toBe(
      'mongodb+srv://u:p%40ss@c.net/db?retryWrites=true&w=majority',
    );
  });

  it.each([
    ['SUMMARY_MAX_MESSAGES', 'abc'],
    ['SUMMARY_MAX_MESSAGES', '0'],
    ['SUMMARY_DEFAULT_DAYS', '1.5'],
    ['GEMINI_TIMEOUT_MS', '0'],
    ['TRANSCRIPTION_CONCURRENCY', 'many'],
    ['TRANSCRIPTION_BOT_USER_ID', '-5'],
    ['MESSAGE_MAX_TOTAL_DOCUMENTS', '-1'],
  ])('rejects an invalid integer in %s (%s)', (key, value) => {
    expect(() => configValidationSchema({ ...env, [key]: value })).toThrow(`${key} must be an integer`);
  });

  it('rejects an unsupported AI_PROVIDER', () => {
    expect(() => configValidationSchema({ ...env, AI_PROVIDER: 'OpenAI' })).toThrow('Unsupported AI_PROVIDER: openai');
  });

  it('lower-cases AI_PROVIDER', () => {
    expect(configValidationSchema({ ...env, AI_PROVIDER: 'Gemini' }).AI_PROVIDER).toBe('gemini');
  });

  it('strips a trailing slash from TRANSCRIPTION_SERVICE_URL', () => {
    expect(
      configValidationSchema({ ...env, TRANSCRIPTION_SERVICE_URL: 'http://svc:4205/' }).TRANSCRIPTION_SERVICE_URL,
    ).toBe('http://svc:4205');
  });

  it("strips a leading '@' from TRANSCRIPTION_BOT_USERNAME", () => {
    expect(
      configValidationSchema({ ...env, TRANSCRIPTION_BOT_USERNAME: '@voice_bot' }).TRANSCRIPTION_BOT_USERNAME,
    ).toBe('voice_bot');
    expect(configValidationSchema({ ...env, TRANSCRIPTION_BOT_USERNAME: 'voice_bot' }).TRANSCRIPTION_BOT_USERNAME).toBe(
      'voice_bot',
    );
  });
});
