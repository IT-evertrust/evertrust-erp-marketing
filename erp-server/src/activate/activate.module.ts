import { Module } from '@nestjs/common';
import { GoogleModule } from '../google/google.module';
import { ActivateController } from './activate.controller';
import { ActivateService } from './activate.service';
import { ActivateResearchService } from './activate-research.service';
import { ActivateRepository } from './activate.repository';
import { ActivateAgentClient } from './activate.agent';
import { GmailReaderService } from './gmail-reader.service';
import { CalendarReaderService } from './calendar-reader.service';
import { ReadAiEmailService } from './read-ai-email.service';
import { ReadAiSignatureGuard } from '../common/guards/read-ai-signature.guard';

// The Activate plane (Growth Engine). GoogleModule is imported so the Gmail/Calendar/Read AI
// readers can resolve live per-account access tokens through GoogleAccountsService — every
// Google call funnels through that one service. ReadAiSignatureGuard gates the @Public()
// read-ai/webhook machine route (HMAC signature verification).
@Module({
  imports: [GoogleModule],
  controllers: [ActivateController],
  providers: [
    ActivateService,
    ActivateResearchService,
    ActivateRepository,
    ActivateAgentClient,
    GmailReaderService,
    CalendarReaderService,
    ReadAiEmailService,
    ReadAiSignatureGuard,
  ],
})
export class ActivateModule {}
