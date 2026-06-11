import { Module } from '@nestjs/common';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';

// Growth Engine module: campaign launch (the AIM sequence) + the AIM n8n webhook
// trigger. DB and AppConfigService are provided globally; the service consumes them.
@Module({
  controllers: [CampaignsController],
  providers: [CampaignsService],
})
export class CampaignsModule {}
