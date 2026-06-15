import { Module } from '@nestjs/common';

import { AiProviderModule } from '../ai/ai-provider.module';
import { MessagesModule } from '../messages/messages.module';
import { TranscriptionModule } from '../transcription/transcription.module';
import { SummaryHandler } from './summary.handler';
import { SummaryService } from './summary.service';
import { SummaryLimitsService } from './summary-limits.service';

@Module({
  imports: [MessagesModule, TranscriptionModule, AiProviderModule],
  providers: [SummaryService, SummaryLimitsService, SummaryHandler],
})
export class SummaryModule {}
