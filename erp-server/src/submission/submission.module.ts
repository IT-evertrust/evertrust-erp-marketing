import { Module } from '@nestjs/common';
import { SubmissionController } from './submission.controller';
import { SubmissionService } from './submission.service';
import { PricingTenantService } from '../pricing/pricing-tenant.service';

// Phase 7 — submission gate + evidence logging. DB is global; PricingTenantService
// is a stateless tenancy resolver reused here (its own instance) so submission
// rejects cross-org access via the owning tender.
@Module({
  controllers: [SubmissionController],
  providers: [SubmissionService, PricingTenantService],
})
export class SubmissionModule {}
