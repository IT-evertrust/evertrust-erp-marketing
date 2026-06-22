import { Module } from '@nestjs/common';
import { GoogleModule } from '../google/google.module';
import { ReplyClassificationsService } from '../outreach/reply-classifications.service';
import { EngageController } from './engage.controller';
import { EngageService } from './engage.service';
import { EngageRepository } from './engage.repository';
import { EngageAgentClient } from './engage.agent';
import { GmailSenderService } from './gmail-sender.service';
import { GmailReaderService } from './gmail-reader.service';

// The Engage plane (Growth Engine), ported from erp-rework and lifted to main's
// conventions. GoogleModule is imported so the Gmail sender/reader can resolve live
// per-account access tokens through GoogleAccountsService — every Google call funnels
// through that one service. The agent (Reply Glock / RAG) is brain-only via the
// monolith /run (engage.reply_glock / engage.rag_agent).
//
// ReplyClassificationsService is the append-only AI verdict log shared with the
// (now-unrouted) Outreach plane; it depends only on the global DB token, so Engage
// provides it directly here rather than importing OutreachModule.
@Module({
  imports: [GoogleModule],
  controllers: [EngageController],
  providers: [
    EngageService,
    EngageRepository,
    EngageAgentClient,
    GmailSenderService,
    GmailReaderService,
    ReplyClassificationsService,
  ],
})
export class EngageGrowthModule {}
