import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { GoogleModule } from '../google/google.module';
import { EngageController } from './engage.controller';
import { EngageService } from './engage.service';
import { EngageRepliesService } from './engage-replies.service';
import { EngageAgentClient } from './engage.agent';

// Engage · ERP-DIRECT Gmail reply pipeline (no n8n, no external Python agent).
// JWT-auth + org-scoped reply triage over the org's connected default Gmail
// mailbox. Imports GoogleModule for the per-org token resolver
// (GoogleAccountsService) and AiModule for the ERP's own Claude. DB is global.
// Reuses the existing reply_classifications + outreach_messages tables — no new
// tables. Wired into AppModule.
@Module({
  imports: [GoogleModule, AiModule],
  controllers: [EngageController],
  providers: [EngageService, EngageRepliesService, EngageAgentClient],
})
export class EngageModule {}
