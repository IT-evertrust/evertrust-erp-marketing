import { Module } from '@nestjs/common';
import { MarketingController } from './marketing.controller';
import { MarketingService } from './marketing.service';

// Marketing · RAG Draft Review — proxies the EVERTRUST - RAG AGENT workflow's
// read/send webhooks. ConfigService is available from the global config module.
@Module({
  controllers: [MarketingController],
  providers: [MarketingService],
})
export class MarketingModule {}
