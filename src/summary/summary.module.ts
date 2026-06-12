import { Module } from '@nestjs/common';

import { MessagesModule } from '../messages/messages.module';
import { TranscriptionModule } from '../transcription/transcription.module';
import { OpenAiService } from './openai.service';
import { SummaryHandler } from './summary.handler';
import { SummaryService } from './summary.service';
import { SummaryLimitsService } from './summary-limits.service';

@Module({
  imports: [MessagesModule, TranscriptionModule],
  providers: [SummaryService, SummaryLimitsService, OpenAiService, SummaryHandler],
})
export class SummaryModule {}
