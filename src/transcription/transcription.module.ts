import { Module } from '@nestjs/common';

import { MessagesModule } from '../messages/messages.module';
import { TranscriptionClientService } from './transcription-client.service';
import { TranscriptionResolverService } from './transcription-resolver.service';

@Module({
  imports: [MessagesModule],
  providers: [TranscriptionClientService, TranscriptionResolverService],
  exports: [TranscriptionResolverService],
})
export class TranscriptionModule {}
