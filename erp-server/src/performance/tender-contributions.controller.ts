import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  CreateTenderContributionDto,
  type TenderContributionDto,
} from '@evertrust/shared';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { OrgId } from '../common/tenant';
import { setAuditContext } from '../common/audit-context';
import { PerformanceService } from './performance.service';

// Tender revenue attribution. Reading needs performance:read; editing the
// contributor list needs performance:write. Mounted at /tenders/:id/contributions
// (lives in the performance module since it feeds contribution scoring).
@Controller()
export class TenderContributionsController {
  constructor(private readonly perf: PerformanceService) {}

  @RequirePermissions('performance:read')
  @Get('tenders/:id/contributions')
  list(
    @OrgId() orgId: string,
    @Param('id') id: string,
  ): Promise<TenderContributionDto[]> {
    return this.perf.listContributions(orgId, id);
  }

  @RequirePermissions('performance:write')
  @Post('tenders/:id/contributions')
  async add(
    @OrgId() orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    const parsed = CreateTenderContributionDto.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? 'Invalid body',
      );
    }
    await this.perf.addContribution(orgId, id, parsed.data);
    setAuditContext(req, {
      entity: 'tender_contributions',
      entityId: id,
      action: 'CREATE',
      after: parsed.data,
    });
    return { ok: true };
  }

  @RequirePermissions('performance:write')
  @Delete('tenders/:id/contributions/:cid')
  async remove(
    @OrgId() orgId: string,
    @Param('id') id: string,
    @Param('cid') cid: string,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    await this.perf.removeContribution(orgId, id, cid);
    setAuditContext(req, {
      entity: 'tender_contributions',
      entityId: cid,
      action: 'DELETE',
    });
    return { ok: true };
  }
}
