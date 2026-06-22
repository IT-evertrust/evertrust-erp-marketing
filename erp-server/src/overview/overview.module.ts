import { Module } from '@nestjs/common';
import { OverviewController } from './overview.controller';
import { OverviewService } from './overview.service';

// The Overview "Engine Activity" plane (Growth Engine dashboard backend), ported from
// erp-rework. Read-only cross-system aggregation; DB is global, so no feature imports.
@Module({
  controllers: [OverviewController],
  providers: [OverviewService],
})
export class OverviewModule {}
