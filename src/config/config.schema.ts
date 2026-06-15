export interface EnvConfig {
  BOT_TOKEN: string;
  PORT: number;
  NODE_ENV: string;
  LOG_LEVEL: string;
  ADMIN_TELEGRAM_ID?: string;
  DB_URL: string;
  DB_MESSAGES_COLLECTION: string;
  AI_PROVIDER: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  SUMMARY_DEFAULT_MESSAGE_COUNT: number;
  SUMMARY_DEFAULT_MINUTES: number;
  SUMMARY_DEFAULT_HOURS: number;
  SUMMARY_DEFAULT_DAYS: number;
  SUMMARY_MAX_MESSAGES: number;
  SUMMARY_MAX_CHARACTERS: number;
  SUMMARY_MAX_TOKENS: number;
  TRANSCRIPTION_BOT_USERNAME?: string;
  TRANSCRIPTION_BOT_USER_ID?: number;
  TRANSCRIPTION_SERVICE_URL: string;
  TRANSCRIPTION_TIMEOUT_MS: number;
}

function get(config: Record<string, unknown>, key: string): string | undefined {
  const v = config[key];
  return v === undefined ? undefined : String(v).trim() || undefined;
}

function requireKey(config: Record<string, unknown>, key: string): string {
  const value = get(config, key);
  if (value === undefined || value === '') {
    throw new Error(`Missing required env: ${key}`);
  }
  return value;
}

function requirePositiveInt(config: Record<string, unknown>, key: string): number {
  const raw = requireKey(config, key);
  const value = Number(raw);
  if (Number.isNaN(value) || value <= 0 || !Number.isInteger(value)) {
    throw new Error(`Invalid positive integer env: ${key}`);
  }
  return value;
}

function optionalPositiveInt(config: Record<string, unknown>, key: string): number | undefined {
  const raw = get(config, key);
  if (raw === undefined) {
    return undefined;
  }
  const value = Number(raw);
  if (Number.isNaN(value) || value <= 0 || !Number.isInteger(value)) {
    throw new Error(`Invalid positive integer env: ${key}`);
  }
  return value;
}

function encodePasswordInUrl(url: string): string {
  const mongoUrlPattern = /^(mongodb\+srv:\/\/)([^:]+):([^@]+)@(.+)$/;
  const match = url.match(mongoUrlPattern);
  if (!match) {
    return url;
  }
  const [, protocol, username, password, rest] = match;
  const isEncoded = password.includes('%');
  const specialChars = /[@#%&+=\s]/;
  const needsEncoding = specialChars.test(password) && !isEncoded;
  if (needsEncoding) {
    return `${protocol}${username}:${encodeURIComponent(password)}@${rest}`;
  }
  return url;
}

function buildMongoUri(url: string): string {
  const urlWithEncodedPassword = encodePasswordInUrl(url);
  const hasParams = urlWithEncodedPassword.includes('?');
  const separator = hasParams ? '&' : '?';
  return `${urlWithEncodedPassword}${separator}retryWrites=true&w=majority`;
}

function resolveBotToken(config: Record<string, unknown>): string {
  return get(config, 'TELEGRAM_BOT_TOKEN') || requireKey(config, 'BOT_TOKEN');
}

function resolveMongoUri(config: Record<string, unknown>): string {
  return buildMongoUri(get(config, 'MONGODB_URI') || requireKey(config, 'DB_URL'));
}

function resolveAiProviderConfig(
  config: Record<string, unknown>,
): Pick<EnvConfig, 'AI_PROVIDER' | 'GEMINI_API_KEY' | 'GEMINI_MODEL'> {
  const aiProvider = (get(config, 'AI_PROVIDER') || 'gemini').toLowerCase();

  if (aiProvider === 'gemini') {
    return {
      AI_PROVIDER: aiProvider,
      GEMINI_API_KEY: requireKey(config, 'GEMINI_API_KEY'),
      GEMINI_MODEL: requireKey(config, 'GEMINI_MODEL'),
    };
  }

  throw new Error(`Unsupported AI_PROVIDER: ${aiProvider}`);
}

export function configValidationSchema(config: Record<string, unknown>): EnvConfig {
  const port = Number(get(config, 'PORT'));
  const portFinal = Number.isNaN(port) || port <= 0 ? 3000 : port;

  const transcriptionTimeoutMs = Number(get(config, 'TRANSCRIPTION_TIMEOUT_MS') || '120000');
  if (Number.isNaN(transcriptionTimeoutMs) || transcriptionTimeoutMs <= 0) {
    throw new Error('Invalid env: TRANSCRIPTION_TIMEOUT_MS');
  }

  return {
    BOT_TOKEN: resolveBotToken(config),
    PORT: portFinal,
    NODE_ENV: get(config, 'NODE_ENV') || 'production',
    LOG_LEVEL: get(config, 'LOG_LEVEL') || 'info',
    ADMIN_TELEGRAM_ID: get(config, 'ADMIN_TELEGRAM_ID'),
    DB_URL: resolveMongoUri(config),
    DB_MESSAGES_COLLECTION: get(config, 'DB_MESSAGES_COLLECTION') || 'chat_messages',
    ...resolveAiProviderConfig(config),
    SUMMARY_DEFAULT_MESSAGE_COUNT: requirePositiveInt(config, 'SUMMARY_DEFAULT_MESSAGE_COUNT'),
    SUMMARY_DEFAULT_MINUTES: requirePositiveInt(config, 'SUMMARY_DEFAULT_MINUTES'),
    SUMMARY_DEFAULT_HOURS: requirePositiveInt(config, 'SUMMARY_DEFAULT_HOURS'),
    SUMMARY_DEFAULT_DAYS: requirePositiveInt(config, 'SUMMARY_DEFAULT_DAYS'),
    SUMMARY_MAX_MESSAGES: requirePositiveInt(config, 'SUMMARY_MAX_MESSAGES'),
    SUMMARY_MAX_CHARACTERS: requirePositiveInt(config, 'SUMMARY_MAX_CHARACTERS'),
    SUMMARY_MAX_TOKENS: requirePositiveInt(config, 'SUMMARY_MAX_TOKENS'),
    TRANSCRIPTION_BOT_USERNAME: get(config, 'TRANSCRIPTION_BOT_USERNAME')?.replace(/^@/, ''),
    TRANSCRIPTION_BOT_USER_ID: optionalPositiveInt(config, 'TRANSCRIPTION_BOT_USER_ID'),
    TRANSCRIPTION_SERVICE_URL: requireKey(config, 'TRANSCRIPTION_SERVICE_URL').replace(/\/$/, ''),
    TRANSCRIPTION_TIMEOUT_MS: transcriptionTimeoutMs,
  };
}
