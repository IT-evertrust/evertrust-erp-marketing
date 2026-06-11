import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  CreateKpiValueDto,
  KpiPeriod,
  type KpiDefinitionDto,
  type PerformanceBriefDto,
  type PerformanceOverviewDto,
  type ScorecardDto,
} from '@evertrust/shared';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { OrgId } from '../common/tenant';
import { setAuditContext } from '../common/audit-context';
import { PerformanceService } from './performance.service';

// Performance Management System. Viewing scorecards/overview is performance:read;
// recording a manual KPI value is performance:write (editing definitions/weights
// — performance:admin — comes in a later phase).
@Controller('performance')
export class PerformanceController {
  constructor(private readonly perf: PerformanceService) {}

  private period(p?: string): KpiPeriod {
    const r = KpiPeriod.safeParse(p);
    return r.success ? r.data : 'WEEKLY';
  }

  @RequirePermissions('performance:read')
  @Get('scorecards')
  list(
    @OrgId() orgId: string,
    @Query('period') period?: string,
  ): Promise<ScorecardDto[]> {
    return this.perf.listScorecards(orgId, this.period(period));
  }

  @RequirePermissions('performance:read')
  @Get('overview')
  overview(
    @OrgId() orgId: string,
    @Query('period') period?: string,
  ): Promise<PerformanceOverviewDto> {
    return this.perf.overview(orgId, this.period(period));
  }

  @RequirePermissions('performance:read')
  @Get('definitions')
  definitions(@OrgId() orgId: string): Promise<KpiDefinitionDto[]> {
    return this.perf.listDefinitions(orgId);
  }

  @RequirePermissions('performance:read')
  @Get('brief')
  brief(
    @OrgId() orgId: string,
    @Query('period') period?: string,
  ): Promise<PerformanceBriefDto> {
    return this.perf.getBrief(orgId, this.period(period));
  }

  @RequirePermissions('performance:write')
  @Post('brief/generate')
  generateBrief(
    @OrgId() orgId: string,
    @Query('period') period?: string,
  ): Promise<PerformanceBriefDto> {
    return this.perf.generateBrief(orgId, this.period(period));
  }

  @RequirePermissions('performance:read')
  @Get('scorecards/:userId')
  async get(
    @OrgId() orgId: string,
    @Param('userId') userId: string,
    @Query('period') period?: string,
  ): Promise<ScorecardDto> {
    const card = await this.perf.getScorecard(orgId, userId, this.period(period));
    if (!card) throw new BadRequestException('No scorecard for this user/period');
    return card;
  }

  @RequirePermissions('performance:write')
  @Post('kpi-values')
  async createValue(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    const parsed = CreateKpiValueDto.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Invalid body');
    }
    await this.perf.createKpiValue(orgId, user.id, parsed.data);
    setAuditContext(req, {
      entity: 'kpi_values',
      entityId: parsed.data.userId,
      action: 'CREATE',
      after: parsed.data,
    });
    return { ok: true };
  }
}
