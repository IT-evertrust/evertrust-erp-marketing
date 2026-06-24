import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { GoogleModule } from '../google/google.module';
import { EngageController } from './engage.controller';
import { EngageService } from './engage.service';
import { EngageRepliesService } from './engage-replies.service';
import { EngageAgentClient } from './engage.agent';
import { EngageScanService } from './engage-scan.service';
import { GmailWatchService } from './gmail-watch.service';
import { EngageScheduler } from './engage-scheduler.service';
import { GmailPushController } from './gmail-push.controller';

// Engage · ERP-DIRECT Gmail reply pipeline (no n8n, no external Python agent).
// JWT-auth + org-scoped reply triage over the org's connected Gmail mailboxes.
// Imports GoogleModule for the per-org token resolver (GoogleAccountsService) and
// AiModule for the ERP's own Claude. DB is global. Adds the automatic-scan layer:
// EngageScheduler (hourly auto-scan + historyId poll fallback + watch renewal),
// GmailWatchService (gmail.watch register/renew + Pub/Sub push handling), and the
// @Public GmailPushController that receives Pub/Sub notifications. Wired into AppModule.
@Module({
  imports: [GoogleModule, AiModule],
  controllers: [EngageController, GmailPushController],
  providers: [
    EngageService,
    EngageRepliesService,
    EngageAgentClient,
    EngageScanService,
    GmailWatchService,
    EngageScheduler,
  ],
})
export class EngageModule {}
