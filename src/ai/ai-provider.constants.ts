export const AI_PROVIDER = Symbol('AI_PROVIDER');

export const AiProviderName = {
  Gemini: 'gemini',
  OpenAi: 'openai',
  Groq: 'groq',
  Ollama: 'ollama',
} as const;

export type AiProviderName = (typeof AiProviderName)[keyof typeof AiProviderName];
