import { Module } from '@nestjs/common';
import { ArsenalTokenGuard } from '../common/guards/arsenal-token.guard';
import { GoogleModule } from '../google/google.module';
import { NichesModule } from '../niches/niches.module';
import { ReachController } from './reach.controller';
import { ReachService } from './reach.service';
import { ReachRepository } from './reach.repository';
import { ReachAgentClient } from './reach.agent';
import { GmailSenderService } from './gmail-sender.service';

// The Reach plane (Growth Engine). GoogleModule is imported so GmailSenderService can
// resolve a live access token for the org's connected Gmail mailbox (every Google call
// funnels through GoogleAccountsService).
@Module({
  imports: [GoogleModule, NichesModule],
  controllers: [ReachController],
  providers: [
    ReachService,
    ReachRepository,
    ReachAgentClient,
    GmailSenderService,
    // Gates the @Public() machine route PATCH aims/:id/scrape-progress (agent → ERP).
    ArsenalTokenGuard,
  ],
  // ReachRepository is exported so EngageModule can propagate a classified reply back
  // into the Reach stats cache + lead status (markLeadReplied).
  exports: [ReachRepository],
})
export class ReachModule {}
