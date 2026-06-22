import { Module } from '@nestjs/common';

import { OverviewController } from './overview.controller';
import { OverviewService } from './overview.service';

// The Overview plane (Growth Engine dashboard). DbModule is @Global, so the DB token is
// injectable here without an import; the service reads the arsenal-run log, n8n workflow
// executions, reply classifications, meetings, Google grants and notifications directly via
// Drizzle (org-scoped) — no Google API calls, so no GoogleModule import is needed.
@Module({
  controllers: [OverviewController],
  providers: [OverviewService],
})
export class OverviewModule {}
