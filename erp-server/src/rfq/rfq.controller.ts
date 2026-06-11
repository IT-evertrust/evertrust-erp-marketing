import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { RfqDto } from '@evertrust/shared';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { OrgId } from '../common/tenant';
import { setAuditContext } from '../common/audit-context';
import { RfqService } from './rfq.service';
import { CreateRfqBodyDto } from './rfq.dto';

// Phase 5c — Hermes supplier RFQ. Tender-scoped: list the RFQs dispatched for a
// tender (pricing:read) and send a new one (pricing:write — same gate as recording
// price evidence, since an RFQ gathers it). Dispatch is audited (entity 'rfqs').
// Tenancy is enforced in the service via the owning tender.
@Controller()
export class RfqController {
  constructor(private readonly rfq: RfqService) {}

  @RequirePermissions('pricing:read')
  @Get('tenders/:tenderId/rfqs')
  list(
    @OrgId() orgId: string,
    @Param('tenderId', ParseUUIDPipe) tenderId: string,
  ): Promise<RfqDto[]> {
    return this.rfq.list(orgId, tenderId) as unknown as Promise<RfqDto[]>;
  }

  @RequirePermissions('pricing:write')
  @Post('tenders/:tenderId/rfqs')
  async create(
    @OrgId() orgId: string,
    @Param('tenderId', ParseUUIDPipe) tenderId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: CreateRfqBodyDto,
    @Req() req: Request,
  ): Promise<RfqDto> {
    const rfq = await this.rfq.create(orgId, tenderId, user.id, body);
    setAuditContext(req, {
      entity: 'rfqs',
      entityId: rfq.id,
      action: 'CREATE',
      after: rfq,
    });
    return rfq as unknown as RfqDto;
  }
}
