import type { RawEnv } from '@randan/tg-bot-kit';
import { buildMongoUri, envInt, envPort, envString, requireEnv } from '@randan/tg-bot-kit';

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
  GEMINI_TIMEOUT_MS: number;
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
  TRANSCRIPTION_SERVICE_TOKEN?: string;
  TRANSCRIPTION_TIMEOUT_MS: number;
  TRANSCRIPTION_CONCURRENCY: number;
  MESSAGE_RETENTION_DAYS: number;
  MESSAGE_MAX_TOTAL_DOCUMENTS: number;
  MESSAGE_MAX_MESSAGES_PER_CHAT: number;
  MESSAGE_CLEANUP_BATCH_SIZE: number;
  MESSAGE_CLEANUP_CRON?: string;
  TIMEZONE: string;
}

/** A required integer >= 1. */
function requirePositiveInt(env: RawEnv, key: string): number {
  requireEnv(env, key);
  return envInt(env, key, 0, 1);
}

/** An integer >= 1, or undefined when unset. */
function optionalPositiveInt(env: RawEnv, key: string): number | undefined {
  return envString(env, key) === undefined ? undefined : envInt(env, key, 0, 1);
}

function resolveAiProviderConfig(env: RawEnv): Pick<EnvConfig, 'AI_PROVIDER' | 'GEMINI_API_KEY' | 'GEMINI_MODEL'> {
  const aiProvider = (envString(env, 'AI_PROVIDER') || 'gemini').toLowerCase();

  if (aiProvider === 'gemini') {
    return {
      AI_PROVIDER: aiProvider,
      GEMINI_API_KEY: requireEnv(env, 'GEMINI_API_KEY'),
      GEMINI_MODEL: requireEnv(env, 'GEMINI_MODEL'),
    };
  }

  throw new Error(`Unsupported AI_PROVIDER: ${aiProvider}`);
}

export function configValidationSchema(env: RawEnv): EnvConfig {
  return {
    BOT_TOKEN: envString(env, 'TELEGRAM_BOT_TOKEN') || requireEnv(env, 'BOT_TOKEN'),
    PORT: envPort(env),
    NODE_ENV: envString(env, 'NODE_ENV') || 'production',
    LOG_LEVEL: envString(env, 'LOG_LEVEL') || 'info',
    ADMIN_TELEGRAM_ID: envString(env, 'ADMIN_TELEGRAM_ID'),
    DB_URL: buildMongoUri(envString(env, 'MONGODB_URI') || requireEnv(env, 'DB_URL')),
    DB_MESSAGES_COLLECTION: envString(env, 'DB_MESSAGES_COLLECTION') || 'chat_messages',
    ...resolveAiProviderConfig(env),
    GEMINI_TIMEOUT_MS: envInt(env, 'GEMINI_TIMEOUT_MS', 90_000, 1),
    SUMMARY_DEFAULT_MESSAGE_COUNT: requirePositiveInt(env, 'SUMMARY_DEFAULT_MESSAGE_COUNT'),
    SUMMARY_DEFAULT_MINUTES: requirePositiveInt(env, 'SUMMARY_DEFAULT_MINUTES'),
    SUMMARY_DEFAULT_HOURS: requirePositiveInt(env, 'SUMMARY_DEFAULT_HOURS'),
    SUMMARY_DEFAULT_DAYS: requirePositiveInt(env, 'SUMMARY_DEFAULT_DAYS'),
    SUMMARY_MAX_MESSAGES: requirePositiveInt(env, 'SUMMARY_MAX_MESSAGES'),
    SUMMARY_MAX_CHARACTERS: requirePositiveInt(env, 'SUMMARY_MAX_CHARACTERS'),
    SUMMARY_MAX_TOKENS: requirePositiveInt(env, 'SUMMARY_MAX_TOKENS'),
    TRANSCRIPTION_BOT_USERNAME: envString(env, 'TRANSCRIPTION_BOT_USERNAME')?.replace(/^@/, ''),
    TRANSCRIPTION_BOT_USER_ID: optionalPositiveInt(env, 'TRANSCRIPTION_BOT_USER_ID'),
    TRANSCRIPTION_SERVICE_URL: requireEnv(env, 'TRANSCRIPTION_SERVICE_URL').replace(/\/$/, ''),
    TRANSCRIPTION_SERVICE_TOKEN: envString(env, 'TRANSCRIPTION_SERVICE_TOKEN'),
    TRANSCRIPTION_TIMEOUT_MS: envInt(env, 'TRANSCRIPTION_TIMEOUT_MS', 120_000, 1),
    TRANSCRIPTION_CONCURRENCY: envInt(env, 'TRANSCRIPTION_CONCURRENCY', 3, 1),
    MESSAGE_RETENTION_DAYS: envInt(env, 'MESSAGE_RETENTION_DAYS', 30, 1),
    MESSAGE_MAX_TOTAL_DOCUMENTS: envInt(env, 'MESSAGE_MAX_TOTAL_DOCUMENTS', 80_000, 0),
    MESSAGE_MAX_MESSAGES_PER_CHAT: envInt(env, 'MESSAGE_MAX_MESSAGES_PER_CHAT', 10_000, 0),
    MESSAGE_CLEANUP_BATCH_SIZE: envInt(env, 'MESSAGE_CLEANUP_BATCH_SIZE', 500, 1),
    MESSAGE_CLEANUP_CRON: envString(env, 'MESSAGE_CLEANUP_CRON'),
    TIMEZONE: envString(env, 'TIMEZONE') || 'Europe/Kyiv',
  };
}
