import { z } from 'zod';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ArsenalStage,
  MarketingReportPeriod,
  type ArsenalBackfillResultDto,
  type ArsenalCallbackResultDto,
  type ClearResultDto,
  type ArsenalExecutionsDto,
  type ArsenalRunDto,
  type ArsenalSettingsDto,
  type MarketingReportDto,
} from '@evertrust/shared';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { OrgId } from '../common/tenant';
import { setAuditContext } from '../common/audit-context';
import { ArsenalTokenGuard } from '../common/guards/arsenal-token.guard';
import { AppConfigService } from '../config/app-config.service';
import { ArsenalService } from './arsenal.service';
import { ArsenalScheduler } from './arsenal.scheduler';
import { N8nExecutionsService } from './n8n-executions.service';
import { N8nBackfillService } from './n8n-backfill.service';
import {
  ArsenalCallbackBodyDto,
  RunArsenalBodyDto,
  UpdateArsenalSettingsBodyDto,
} from './arsenal.dto';

// Arsenal triggers: manual "Run now" for the outbound stages + the run history.
// Viewing runs is campaigns:read; firing a stage is campaigns:write (it sends real
// outbound work). Each run is recorded (arsenal_runs) and audited.
@Controller('arsenal')
export class ArsenalController {
  constructor(
    private readonly arsenal: ArsenalService,
    private readonly scheduler: ArsenalScheduler,
    private readonly n8nExec: N8nExecutionsService,
    private readonly backfill: N8nBackfillService,
    private readonly config: AppConfigService,
  ) {}

  @RequirePermissions('campaigns:read')
  @Get('runs')
  listRuns(@OrgId() orgId: string): Promise<ArsenalRunDto[]> {
    return this.arsenal.listRuns(orgId) as unknown as Promise<ArsenalRunDto[]>;
  }

  // Clear the run feed (test-data reset). Destructive → campaigns:write + audited.
  @RequirePermissions('campaigns:write')
  @Delete('runs')
  async clearRuns(
    @OrgId() orgId: string,
    @Req() req: Request,
  ): Promise<ClearResultDto> {
    const deleted = await this.arsenal.clearRuns(orgId);
    setAuditContext(req, {
      entity: 'arsenal_runs',
      entityId: orgId,
      action: 'CLEAR',
      after: { deleted },
    });
    return { deleted };
  }

  // The org's editable Growth-Engine settings (the daily Bazooka send time).
  @RequirePermissions('campaigns:read')
  @Get('settings')
  getSettings(@OrgId() orgId: string): Promise<ArsenalSettingsDto> {
    return this.arsenal.getSettings(orgId) as unknown as Promise<ArsenalSettingsDto>;
  }

  // Live per-stage n8n execution status (RUNNING/SUCCESS/ERROR/IDLE) for the
  // sequence strip's real run-state animation. Read-only + org-agnostic (one n8n
  // instance). Returns { configured:false } when the n8n API isn't wired up.
  @RequirePermissions('campaigns:read')
  @Get('executions')
  executions(): Promise<ArsenalExecutionsDto> {
    return this.n8nExec.getStatuses() as unknown as Promise<ArsenalExecutionsDto>;
  }

  // The Marketing report — Growth-Engine sequence aggregated by period. `period`
  // defaults to 'week' and falls back to 'week' on an unknown value (lenient query).
  @RequirePermissions('campaigns:read')
  @Get('report')
  report(
    @OrgId() orgId: string,
    @Query('period') periodParam?: string,
    @Query('campaignId') campaignIdParam?: string,
  ): Promise<MarketingReportDto> {
    const parsed = MarketingReportPeriod.safeParse(periodParam ?? 'week');
    const period = parsed.success ? parsed.data : 'week';
    // Optional campaign scope; ignore a malformed id (treat as org-wide).
    const campaignId = z.string().uuid().safeParse(campaignIdParam).success
      ? campaignIdParam
      : undefined;
    return this.arsenal.getReport(orgId, period, campaignId) as unknown as Promise<MarketingReportDto>;
  }

  // Backfill the report's funnel from n8n's execution history — imports recent
  // autonomous runs (with metrics read from execution data) as arsenal_runs.
  // Idempotent (deduped by execution id). campaigns:write — it writes run rows.
  @RequirePermissions('campaigns:write')
  @Post('backfill')
  async runBackfill(
    @OrgId() orgId: string,
    @Req() req: Request,
  ): Promise<ArsenalBackfillResultDto> {
    const result = await this.backfill.sync(orgId);
    setAuditContext(req, {
      entity: 'arsenal_runs',
      entityId: orgId,
      action: 'BACKFILL',
      after: result,
    });
    return result;
  }

  // Set/clear the daily Bazooka time (null = off). Persists AND re-arms the
  // scheduler immediately, so the change takes effect without a redeploy.
  @RequirePermissions('campaigns:write')
  @Put('settings')
  async updateSettings(
    @OrgId() orgId: string,
    @Body() body: UpdateArsenalSettingsBodyDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<ArsenalSettingsDto> {
    const saved = await this.arsenal.updateSettings(
      orgId,
      {
        bazookaDailyAt: body.bazookaDailyAt,
        bazookaTimezone: body.bazookaTimezone,
      },
      user.id,
    );
    this.scheduler.applyForOrg(
      orgId,
      saved.bazookaDailyAt,
      saved.bazookaTimezone,
    );
    setAuditContext(req, {
      entity: 'arsenal_settings',
      entityId: orgId,
      action: 'UPDATE',
      after: saved,
    });
    return saved as unknown as ArsenalSettingsDto;
  }

  // n8n→ERP run callback. PUBLIC (no JWT — n8n has no session); gated by the shared
  // ARSENAL_INGEST_TOKEN in the `x-arsenal-token` header via ArsenalTokenGuard
  // (503 if the token is unset, 401 on a bad token). n8n posts a stage's autonomous
  // run outcome here so it lands in the per-campaign Live activity feed. When a
  // campaignId + driveFolderId are sent, the Ammo Forge folder is persisted onto the
  // campaign. 404 if the named campaign / Drive folder is unknown. Returns the run id.
  @Public()
  @UseGuards(ArsenalTokenGuard)
  @Post('runs/callback')
  @HttpCode(HttpStatus.ACCEPTED)
  async callback(
    @Body() body: ArsenalCallbackBodyDto,
  ): Promise<ArsenalCallbackResultDto> {
    const { id } = await this.arsenal.recordCallback({
      stage: body.stage,
      status: body.status,
      campaignId: body.campaignId,
      driveFolderId: body.driveFolderId,
      detail: body.detail,
      metrics: body.metrics,
    });
    return { ok: true, id };
  }

  @RequirePermissions('campaigns:write')
  @Post(':stage/run')
  async run(
    @OrgId() orgId: string,
    @Param('stage') stageParam: string,
    @Body() body: RunArsenalBodyDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<ArsenalRunDto> {
    // Validate the :stage path segment against the enum (it's not body-validated).
    const parsed = ArsenalStage.safeParse(stageParam);
    if (!parsed.success) {
      throw new BadRequestException(`Unknown arsenal stage: ${stageParam}`);
    }
    const run = await this.arsenal.run(orgId, parsed.data, {
      campaignId: body.campaignId,
      source: 'MANUAL',
      userId: user.id,
    });
    setAuditContext(req, {
      entity: 'arsenal_runs',
      entityId: run.id,
      action: 'RUN',
      after: run,
    });
    return run as unknown as ArsenalRunDto;
  }
}
