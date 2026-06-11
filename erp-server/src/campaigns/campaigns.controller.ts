import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type {
  CampaignDto,
  CampaignFilesDto,
  CampaignSyncResultDto,
} from '@evertrust/shared';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { OrgId } from '../common/tenant';
import { setAuditContext } from '../common/audit-context';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignBodyDto } from './campaigns.dto';

// Growth Engine (the "AIM sequence"). Tenant-scoped, permission-gated. Listing/
// reading is campaigns:read; launching ("Lock & Load") is campaigns:write — it
// persists the campaign AND fires the AIM n8n webhook server-side. The launch is
// audited (entity 'campaigns'); the persisted row's status reflects the deploy
// outcome (DEPLOYED / FAILED / DRAFT).
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @RequirePermissions('campaigns:read')
  @Get()
  list(@OrgId() orgId: string): Promise<CampaignDto[]> {
    return this.campaigns.list(orgId) as unknown as Promise<CampaignDto[]>;
  }

  @RequirePermissions('campaigns:read')
  @Get(':id')
  get(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CampaignDto> {
    return this.campaigns.get(orgId, id) as unknown as Promise<CampaignDto>;
  }

  // Every file in the campaign's Drive folder (via erp-campaign-files webhook).
  @RequirePermissions('campaigns:read')
  @Get(':id/files')
  files(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CampaignFilesDto> {
    return this.campaigns.listFiles(orgId, id);
  }

  // Reconcile the campaign list against the live Drive "Evertrust Campaigns" folder
  // (the source of truth) via the read-only erp-campaigns-list n8n webhook. Archives
  // campaigns whose folder was deleted (driveMissing → hidden from list), un-archives
  // ones that reappeared. Audited as a bulk UPDATE. campaigns:write — it mutates rows.
  @RequirePermissions('campaigns:write')
  @Post('sync')
  async sync(
    @OrgId() orgId: string,
    @Req() req: Request,
  ): Promise<CampaignSyncResultDto> {
    const result = await this.campaigns.syncFromDrive(orgId);
    setAuditContext(req, {
      entity: 'campaigns',
      action: 'UPDATE',
      after: result,
    });
    return result;
  }

  @RequirePermissions('campaigns:write')
  @Post()
  async create(
    @OrgId() orgId: string,
    @Body() body: CreateCampaignBodyDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<CampaignDto> {
    const campaign = await this.campaigns.create(orgId, body, user.id);
    setAuditContext(req, {
      entity: 'campaigns',
      entityId: campaign.id,
      action: 'CREATE',
      after: campaign,
    });
    return campaign as unknown as CampaignDto;
  }

  // Delete a campaign (ERP record only — the Drive folder + leads are untouched).
  @RequirePermissions('campaigns:write')
  @Delete(':id')
  async remove(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<{ id: string }> {
    const before = await this.campaigns.delete(orgId, id);
    setAuditContext(req, {
      entity: 'campaigns',
      entityId: id,
      action: 'DELETE',
      before,
    });
    return { id };
  }
}
