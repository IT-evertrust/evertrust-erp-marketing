import { Module } from '@nestjs/common';
import { GoogleModule } from '../google/google.module';
import { ActivateController } from './activate.controller';
import { ActivateService } from './activate.service';
import { ActivateRepository } from './activate.repository';
import { ActivateAgentClient } from './activate.agent';
import { GmailReaderService } from './gmail-reader.service';
import { CalendarReaderService } from './calendar-reader.service';
import { ReadAiEmailService } from './read-ai-email.service';

// The Activate plane (Growth Engine). GoogleModule is imported so the Gmail/Calendar/Read AI
// readers can resolve live per-account access tokens through GoogleAccountsService — every
// Google call funnels through that one service.
@Module({
  imports: [GoogleModule],
  controllers: [ActivateController],
  providers: [
    ActivateService,
    ActivateRepository,
    ActivateAgentClient,
    GmailReaderService,
    CalendarReaderService,
    ReadAiEmailService,
  ],
})
export class ActivateModule {}
