import { Module } from '@nestjs/common';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

// Key Account hot-lead CRM. DB + AppConfigService are global; the service consumes
// them to list/convert leads + backfill from / trigger the n8n hot-leads workflows.
@Module({
  controllers: [LeadsController],
  providers: [LeadsService],
})
export class LeadsModule {}
