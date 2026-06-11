import { Module } from '@nestjs/common';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';

// Phase 6 (R30) customer-approval gate: record approval requests + decisions. The
// HARD "no approval → no submission" block lives in TendersService.transition; this
// module owns the data that gate reads. The DB client is provided globally by
// DbModule; the service just consumes it.
@Module({
  controllers: [ApprovalsController],
  providers: [ApprovalsService],
})
export class ApprovalsModule {}
