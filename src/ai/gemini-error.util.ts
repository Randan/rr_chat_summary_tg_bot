export class GeminiQuotaError extends Error {
  constructor(message = 'Gemini API quota exceeded') {
    super(message);
    this.name = 'GeminiQuotaError';
  }
}

export function mapGeminiError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  const isQuotaError =
    message.includes('429') ||
    message.includes('RESOURCE_EXHAUSTED') ||
    message.includes('quota') ||
    message.includes('Quota exceeded');

  if (isQuotaError) {
    return new GeminiQuotaError(message);
  }

  return err instanceof Error ? err : new Error(message);
}
