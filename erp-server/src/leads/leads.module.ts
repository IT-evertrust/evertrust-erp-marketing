import { Module } from '@nestjs/common';
import { NichesModule } from '../niches/niches.module';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

// Key Account hot-lead CRM. DB + AppConfigService are global; the service consumes
// them to list/convert leads + backfill from / trigger the n8n hot-leads workflows.
// NichesModule provides NichesService for free-text niche → nicheId resolution.
@Module({
  imports: [NichesModule],
  controllers: [LeadsController],
  providers: [LeadsService],
  // Exported so ProspectsModule can graduate a prospect into a hot lead.
  exports: [LeadsService],
})
export class LeadsModule {}
