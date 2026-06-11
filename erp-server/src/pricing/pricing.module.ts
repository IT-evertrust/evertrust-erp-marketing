import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { LineItemsController } from './line-items.controller';
import { PricingController } from './pricing.controller';
import { LineItemsService } from './line-items.service';
import { ObservationsService } from './observations.service';
import { PriceAssistService } from './price-assist.service';
import { PricingService } from './pricing.service';
import { PricingTenantService } from './pricing-tenant.service';

// Phase 5a pricing core: LV line items, price observations (evidence), and the
// deterministic pricing engine surfaced over HTTP. Phase 5b adds Claude
// price-assist (PriceAssistService → AiModule's ClaudeService). The DB client is
// provided globally by DbModule; these services just consume it.
@Module({
  imports: [AiModule],
  controllers: [LineItemsController, PricingController],
  providers: [
    LineItemsService,
    ObservationsService,
    PriceAssistService,
    PricingService,
    PricingTenantService,
  ],
})
export class PricingModule {}
