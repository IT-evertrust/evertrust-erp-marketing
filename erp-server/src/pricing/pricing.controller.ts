import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { TenderPricingDto } from '@evertrust/shared';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { OrgId } from '../common/tenant';
import { setAuditContext } from '../common/audit-context';
import { ObservationsService } from './observations.service';
import { PricingService } from './pricing.service';
import { UpsertPricingBodyDto } from './pricing.dto';

// Tender-level pricing: the computed view (engine output + totals + risk), the
// margin upsert, and finalize (which also advances the tender state machine).
// Plus the standalone price-observation delete. All tenant-scoped via the owning
// tender (404 otherwise). Reads gated by pricing:read; writes by pricing:write;
// finalize by pricing:approve. Mutations audited.
@Controller()
export class PricingController {
  constructor(
    private readonly pricing: PricingService,
    private readonly observations: ObservationsService,
  ) {}

  // Standalone observation delete (the nested create/list live on
  // LineItemsController). pricing:write — same authority as creating one.
  @RequirePermissions('pricing:write')
  @Delete('price-observations/:id')
  async removeObservation(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<{ id: string }> {
    const before = await this.observations.remove(orgId, id);
    setAuditContext(req, {
      entity: 'price_observations',
      entityId: id,
      action: 'DELETE',
      before,
    });
    return { id };
  }

  // The computed pricing view for a tender. Read-only; never mutates.
  @RequirePermissions('pricing:read')
  @Get('tenders/:tenderId/pricing')
  getPricing(
    @OrgId() orgId: string,
    @Param('tenderId', ParseUUIDPipe) tenderId: string,
  ): Promise<TenderPricingDto> {
    return this.pricing.getPricing(orgId, tenderId);
  }

  // Upsert the tender's pricing from a margin %. subtotal/finalPrice recomputed
  // server-side; status reset to DRAFT.
  @RequirePermissions('pricing:write')
  @Put('tenders/:tenderId/pricing')
  async upsertPricing(
    @OrgId() orgId: string,
    @Param('tenderId', ParseUUIDPipe) tenderId: string,
    @Body() body: UpsertPricingBodyDto,
    @Req() req: Request,
  ): Promise<TenderPricingDto> {
    const { before, after } = await this.pricing.upsertPricing(
      orgId,
      tenderId,
      body.marginPct,
    );
    setAuditContext(req, {
      entity: 'pricings',
      entityId: after.id,
      action: before ? 'UPDATE' : 'CREATE',
      before,
      after,
    });
    // Return the freshly recomputed full view so the client need not re-fetch.
    return this.pricing.getPricing(orgId, tenderId);
  }

  // Finalize pricing: pricings -> FINAL (+decidedBy) and advance the tender
  // PIC_PRICING -> CUSTOMER_PRICING. pricing:approve only (L1/L2/L3).
  @RequirePermissions('pricing:approve')
  @Post('tenders/:tenderId/pricing/finalize')
  async finalize(
    @OrgId() orgId: string,
    @Param('tenderId', ParseUUIDPipe) tenderId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<TenderPricingDto> {
    const { before, after } = await this.pricing.finalize(
      orgId,
      tenderId,
      user.id,
    );
    setAuditContext(req, {
      entity: 'pricings',
      entityId: after.pricing.id,
      action: 'FINALIZE',
      before: { status: before.pricing.status, tenderStatus: before.status },
      after: { status: after.pricing.status, tenderStatus: after.status },
    });
    return this.pricing.getPricing(orgId, tenderId);
  }
}
