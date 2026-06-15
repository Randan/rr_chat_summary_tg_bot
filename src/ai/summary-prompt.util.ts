import type { GenerateSummaryInput } from './ai-provider.types';

export function buildSummaryUserPrompt(input: GenerateSummaryInput): string {
  return [`Період аналізу: ${input.periodLabel}`, input.analyzedInfo, '', 'Лог чату:', input.dialogue].join('\n');
}
