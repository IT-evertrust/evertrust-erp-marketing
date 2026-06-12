import { Module } from '@nestjs/common';
import { ArsenalTokenGuard } from '../common/guards/arsenal-token.guard';
import { NichesModule } from '../niches/niches.module';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { CampaignAssetsService } from './campaign-assets.service';

// Growth Engine module: campaign launch (the AIM sequence) + the AIM n8n webhook
// trigger + the Drive-artifact registry. DB and AppConfigService are provided
// globally; the services consume them. NichesModule provides NichesService (niche
// find-or-create + target lookup); ArsenalTokenGuard gates the @Public() machine
// config/list/assets routes.
@Module({
  imports: [NichesModule],
  controllers: [CampaignsController],
  providers: [CampaignsService, CampaignAssetsService, ArsenalTokenGuard],
})
export class CampaignsModule {}
