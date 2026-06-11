import { Module } from '@nestjs/common';
import { RfqController } from './rfq.controller';
import { RfqService } from './rfq.service';
import { PricingTenantService } from '../pricing/pricing-tenant.service';

// Phase 5c — Hermes supplier RFQ. Fires the Hermes n8n webhook + records dispatches
// in `rfqs`. DB + AppConfigService are global; PricingTenantService is a stateless
// tenancy resolver reused here (its own instance) so an RFQ rejects cross-org access
// via the owning tender.
@Module({
  controllers: [RfqController],
  providers: [RfqService, PricingTenantService],
})
export class RfqModule {}
