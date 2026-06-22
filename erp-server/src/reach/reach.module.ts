import { Module } from '@nestjs/common';
import { GoogleModule } from '../google/google.module';
import { ReachController } from './reach.controller';
import { ReachService } from './reach.service';
import { ReachRepository } from './reach.repository';
import { ReachAgentClient } from './reach.agent';
import { GmailSenderService } from './gmail-sender.service';

// The Reach plane (Growth Engine). GoogleModule is imported so GmailSenderService can
// resolve a live access token for the org's connected Gmail mailbox (every Google call
// funnels through GoogleAccountsService).
@Module({
  imports: [GoogleModule],
  controllers: [ReachController],
  providers: [ReachService, ReachRepository, ReachAgentClient, GmailSenderService],
})
export class ReachModule {}
