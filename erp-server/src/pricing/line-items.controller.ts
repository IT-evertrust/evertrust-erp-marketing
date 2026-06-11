import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type {
  LineItemDto,
  PriceAssistResultDto,
  PriceObservationDto,
} from '@evertrust/shared';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { OrgId } from '../common/tenant';
import { setAuditContext } from '../common/audit-context';
import { LineItemsService } from './line-items.service';
import { ObservationsService } from './observations.service';
import { PriceAssistService } from './price-assist.service';
import {
  CreateLineItemBodyDto,
  CreatePriceObservationBodyDto,
  UpdateLineItemBodyDto,
} from './pricing.dto';

// LV line items + their price observations. Tenancy is inherited via the owning
// tender (loaded under tenantScope in the services) — children carry NO
// organizationId. Reads are gated by tenders:read/pricing:read; writes by
// tenders:write/pricing:write. Mutations are audited (entity 'line_items' /
// 'price_observations').
@Controller()
export class LineItemsController {
  constructor(
    private readonly lineItems: LineItemsService,
    private readonly observations: ObservationsService,
    private readonly assist: PriceAssistService,
  ) {}

  // ---- Line items ----

  @RequirePermissions('tenders:read')
  @Get('tenders/:tenderId/line-items')
  list(
    @OrgId() orgId: string,
    @Param('tenderId', ParseUUIDPipe) tenderId: string,
  ): Promise<LineItemDto[]> {
    // Service returns Drizzle rows (string numerics); Nest serializes to the
    // LineItemDto wire shape at the HTTP boundary.
    return this.lineItems.list(orgId, tenderId) as unknown as Promise<
      LineItemDto[]
    >;
  }

  @RequirePermissions('tenders:write')
  @Post('tenders/:tenderId/line-items')
  async create(
    @OrgId() orgId: string,
    @Param('tenderId', ParseUUIDPipe) tenderId: string,
    @Body() body: CreateLineItemBodyDto,
    @Req() req: Request,
  ): Promise<LineItemDto> {
    const item = await this.lineItems.create(orgId, tenderId, body);
    setAuditContext(req, {
      entity: 'line_items',
      entityId: item.id,
      action: 'CREATE',
      after: item,
    });
    return item as unknown as LineItemDto;
  }

  @RequirePermissions('tenders:write')
  @Patch('line-items/:id')
  async update(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateLineItemBodyDto,
    @Req() req: Request,
  ): Promise<LineItemDto> {
    const { before, after } = await this.lineItems.update(orgId, id, body);
    setAuditContext(req, {
      entity: 'line_items',
      entityId: after.id,
      action: 'UPDATE',
      before,
      after,
    });
    return after as unknown as LineItemDto;
  }

  @RequirePermissions('tenders:write')
  @Delete('line-items/:id')
  async remove(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<{ id: string }> {
    const before = await this.lineItems.remove(orgId, id);
    setAuditContext(req, {
      entity: 'line_items',
      entityId: id,
      action: 'DELETE',
      before,
    });
    return { id };
  }

  // ---- Price observations (nested under a line item) ----

  @RequirePermissions('pricing:read')
  @Get('line-items/:id/observations')
  listObservations(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PriceObservationDto[]> {
    return this.observations.list(orgId, id) as unknown as Promise<
      PriceObservationDto[]
    >;
  }

  @RequirePermissions('pricing:write')
  @Post('line-items/:id/observations')
  async createObservation(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: CreatePriceObservationBodyDto,
    @Req() req: Request,
  ): Promise<PriceObservationDto> {
    const obs = await this.observations.create(orgId, id, user.id, body);
    setAuditContext(req, {
      entity: 'price_observations',
      entityId: obs.id,
      action: 'CREATE',
      after: obs,
    });
    return obs as unknown as PriceObservationDto;
  }

  // ---- Claude price-assist (Phase 5b) ----
  // Ask Claude for a unit-price SUGGESTION for an (unbacked) line. Returns the
  // suggestion + confidence; never mutates pricing (the human accepts it as an
  // AI_ESTIMATE observation via POST .../observations). pricing:write — same gate
  // as recording evidence. Not audited here: the model run is logged to ai_runs,
  // and the human's accept is audited as the observation it creates.
  @RequirePermissions('pricing:write')
  @Post('line-items/:id/price-assist')
  priceAssist(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PriceAssistResultDto> {
    return this.assist.suggest(orgId, id);
  }
}
