import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  CampaignLifecycle,
  type CampaignAssetResultDto,
  type CampaignConfigDto,
  type CampaignDto,
  type CampaignFilesDto,
  type CampaignMachineListItemDto,
  type CampaignTemplatesDto,
} from '@evertrust/shared';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { OrgId } from '../common/tenant';
import { setAuditContext } from '../common/audit-context';
import { ArsenalTokenGuard } from '../common/guards/arsenal-token.guard';
import { CampaignsService } from './campaigns.service';
import { CampaignAssetsService } from './campaign-assets.service';
import { CampaignTemplatesService } from './campaign-templates.service';
import {
  CampaignAssetBodyDto,
  CampaignTemplatesBodyDto,
  CreateCampaignBodyDto,
  UpdateCampaignLifecycleBodyDto,
} from './campaigns.dto';

// Response of POST /campaigns: the launched campaign + an optional deployError
// (non-null when the AIM webhook was unset or failed; the campaign is then DRAFT).
interface CampaignLaunchResponse extends CampaignDto {
  deployError: string | null;
}

// Growth Engine (the "AIM sequence"). Tenant-scoped, permission-gated for the UI
// routes; MACHINE routes (config + machine list) are @Public() + ArsenalTokenGuard
// for the autonomous arsenal. Launching ("Lock & Load") and lifecycle moves are
// campaigns:write and audited.
@Controller('campaigns')
export class CampaignsController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly assets: CampaignAssetsService,
    private readonly templates: CampaignTemplatesService,
  ) {}

  @RequirePermissions('campaigns:read')
  @Get()
  list(@OrgId() orgId: string): Promise<CampaignDto[]> {
    return this.campaigns.list(orgId) as unknown as Promise<CampaignDto[]>;
  }

  // Machine campaign list filtered by lifecycle (the daily scheduler). Declared
  // BEFORE :id so "machine" isn't captured as a campaign id. @Public() + token.
  @Public()
  @UseGuards(ArsenalTokenGuard)
  @Get('machine/list')
  machineList(
    @Query('lifecycle') lifecycleParam?: string,
  ): Promise<CampaignMachineListItemDto[]> {
    const parsed = CampaignLifecycle.safeParse(lifecycleParam ?? 'ACTIVE');
    if (!parsed.success) {
      throw new BadRequestException(`Unknown lifecycle: ${lifecycleParam}`);
    }
    return this.campaigns.machineList(parsed.data);
  }

  @RequirePermissions('campaigns:read')
  @Get(':id')
  get(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CampaignDto> {
    return this.campaigns.get(orgId, id) as unknown as Promise<CampaignDto>;
  }

  // Machine config (the arsenal stages' view of a campaign + its enabled targets).
  // @Public() + token; NOT org-scoped (the token is the trust boundary). 404 unknown.
  @Public()
  @UseGuards(ArsenalTokenGuard)
  @Get(':id/config')
  config(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CampaignConfigDto> {
    return this.campaigns.getConfig(id);
  }

  // Every file in the campaign's Drive folder (via the erp-campaign-files webhook).
  @RequirePermissions('campaigns:read')
  @Get(':id/files')
  files(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CampaignFilesDto> {
    return this.campaigns.listFiles(orgId, id);
  }

  // Register a Drive artifact the arsenal generated (upsert on driveFileId). MACHINE
  // route: @Public() + token; org derived from the campaign. 404 unknown campaign.
  @Public()
  @UseGuards(ArsenalTokenGuard)
  @Post(':id/assets')
  registerAsset(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CampaignAssetBodyDto,
  ): Promise<CampaignAssetResultDto> {
    return this.assets.upsert(id, body);
  }

  // Set Ammo Forge content blocks (coldEmail, slotProposal, …) the outreach
  // workflows read instead of Drive templates. MERGES into campaigns.templates
  // (existing keys survive; same key overwrites), so blocks can be set
  // incrementally. MACHINE route: @Public() + token; org derived from the
  // campaign. 404 unknown campaign. Responds the merged map.
  @Public()
  @UseGuards(ArsenalTokenGuard)
  @Post(':id/templates')
  setTemplates(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CampaignTemplatesBodyDto,
  ): Promise<CampaignTemplatesDto> {
    return this.templates.merge(id, body.templates);
  }

  @RequirePermissions('campaigns:write')
  @Post()
  async create(
    @OrgId() orgId: string,
    @Body() body: CreateCampaignBodyDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<CampaignLaunchResponse> {
    const { campaign, deployError } = await this.campaigns.create(
      orgId,
      body,
      user.id,
    );
    setAuditContext(req, {
      entity: 'campaigns',
      entityId: campaign.id,
      action: 'CREATE',
      after: campaign,
    });
    return {
      ...(campaign as unknown as CampaignDto),
      deployError,
    };
  }

  // Move a campaign through its lifecycle (DRAFT→ACTIVE, ACTIVE↔PAUSED, →ARCHIVED).
  // 422 on an illegal transition. campaigns:write + audited.
  @RequirePermissions('campaigns:write')
  @Patch(':id/lifecycle')
  async updateLifecycle(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateCampaignLifecycleBodyDto,
    @Req() req: Request,
  ): Promise<CampaignDto> {
    const { before, after } = await this.campaigns.updateLifecycle(
      orgId,
      id,
      body.lifecycle,
    );
    setAuditContext(req, {
      entity: 'campaigns',
      entityId: id,
      action: 'LIFECYCLE',
      before,
      after,
    });
    return after as unknown as CampaignDto;
  }

  // Delete a campaign (ERP record only — the Drive folder + leads are untouched).
  @RequirePermissions('campaigns:write')
  @Delete(':id')
  async remove(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<{ id: string }> {
    const deleted = await this.campaigns.delete(orgId, id);
    setAuditContext(req, {
      entity: 'campaigns',
      entityId: id,
      action: 'DELETE',
      before: deleted,
    });
    return { id };
  }
}
