import type { GenerateSummaryInput } from './ai-provider.types';

export function buildSummaryUserPrompt(input: GenerateSummaryInput): string {
  return [
    `Період аналізу: ${input.periodLabel}`,
    input.analyzedInfo,
    '',
    'Склади підсумок виключно українською мовою.',
    '',
    'Лог чату:',
    input.dialogue,
  ].join('\n');
}
