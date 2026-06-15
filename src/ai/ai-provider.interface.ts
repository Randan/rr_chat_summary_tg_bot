import type { GenerateSummaryInput } from './ai-provider.types';

export interface AiProvider {
  generateSummary(input: GenerateSummaryInput): Promise<string>;
}
