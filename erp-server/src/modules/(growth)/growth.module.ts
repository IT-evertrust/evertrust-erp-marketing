import { Module } from '@nestjs/common';

import { AuthModule } from '../../auth/auth.module';
import { OutreachModule } from '../../outreach/outreach.module';

import { OverviewController } from './overview/overview.controller';
import { OverviewService } from './overview/overview.service';

import { ReachController } from './reach/reach.controller';
import { ReachRepository } from './reach/reach.repository';
import { ReachService } from './reach/reach.service';
import { ReachAgentClient } from './reach/reach.agent';
import { GmailSenderService } from './shared/gmail-sender.service';
import { GmailReaderService } from './shared/gmail-reader.service';
import { CalendarReaderService } from './shared/calendar-reader.service';
import { ReadAiEmailService } from './shared/read-ai-email.service';

import { EngageController } from './engage/engage.controller';
import { EngageRepository } from './engage/engage.repository';
import { EngageService } from './engage/engage.service';
import { EngageAgentClient } from './engage/engage.agent';

import { ActivateController } from './activate/activate.controller';
import { ActivateRepository } from './activate/activate.repository';
import { ActivateService } from './activate/activate.service';
import { ActivateAgentClient } from './activate/activate.agent';

@Module({
  imports: [OutreachModule, AuthModule],
  controllers: [
    OverviewController,
    ReachController,
    EngageController,
    ActivateController,
  ],
  providers: [
    OverviewService,
    ReachService,
    ReachRepository,
    ReachAgentClient,
    GmailSenderService,
    EngageService,
    EngageRepository,
    EngageAgentClient,
    ActivateService,
    ActivateRepository,
    ActivateAgentClient,
    CalendarReaderService,
    GmailReaderService,
    ReadAiEmailService,
  ],
  exports: [
    OverviewService,
    ReachService,
    EngageService,
    ActivateService,
  ],
})
export class GrowthModule {}
