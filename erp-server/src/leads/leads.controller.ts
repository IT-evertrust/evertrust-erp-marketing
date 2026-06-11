import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  LeadStage,
  type ClearResultDto,
  type LeadBackfillResultDto,
  type LeadDto,
  type ProvisionHotLeadsResultDto,
  type RunHotLeadsPipelineResultDto,
} from '@evertrust/shared';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { OrgId } from '../common/tenant';
import { setAuditContext } from '../common/audit-context';
import { LeadsService } from './leads.service';
import {
  CreateLeadBodyDto,
  LeadCampaignActionBodyDto,
  UpdateLeadBodyDto,
} from './leads.dto';

// Key Account hot-lead CRM. Viewing leads is campaigns:read; mutating is
// campaigns:write; graduating to a customer is customers:write (it creates a
// customer record). Every mutation is recorded + audited.
@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @RequirePermissions('campaigns:read')
  @Get()
  list(
    @OrgId() orgId: string,
    @Query('stage') stageParam?: string,
    @Query('campaignId') campaignIdParam?: string,
  ): Promise<LeadDto[]> {
    const stage = LeadStage.safeParse(stageParam);
    const campaignId = z.string().uuid().safeParse(campaignIdParam);
    return this.leads.list(orgId, {
      stage: stage.success ? stage.data : undefined,
      campaignId: campaignId.success ? campaignIdParam : undefined,
    }) as unknown as Promise<LeadDto[]>;
  }

  @RequirePermissions('campaigns:write')
  @Post()
  async create(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: CreateLeadBodyDto,
    @Req() req: Request,
  ): Promise<LeadDto> {
    const lead = await this.leads.create(orgId, user.id, body);
    setAuditContext(req, {
      entity: 'leads',
      entityId: lead.id,
      action: 'CREATE',
      after: lead,
    });
    return lead as unknown as LeadDto;
  }

  // Clear all of the org's leads (test-data reset). Destructive → audited.
  @RequirePermissions('campaigns:write')
  @Delete()
  async clear(
    @OrgId() orgId: string,
    @Req() req: Request,
  ): Promise<ClearResultDto> {
    const deleted = await this.leads.clearLeads(orgId);
    setAuditContext(req, {
      entity: 'leads',
      entityId: orgId,
      action: 'CLEAR',
      after: { deleted },
    });
    return { deleted };
  }

  // Import hot leads + graduated customers from the Hot Leads Pipeline.
  @RequirePermissions('campaigns:write')
  @Post('backfill')
  async backfill(
    @OrgId() orgId: string,
    @Req() req: Request,
  ): Promise<LeadBackfillResultDto> {
    const result = await this.leads.backfill(orgId);
    setAuditContext(req, {
      entity: 'leads',
      entityId: orgId,
      action: 'BACKFILL',
      after: result,
    });
    return result;
  }

  // Fire the Provision Hot Leads webhook for a campaign (creates its hot_leads sheet).
  @RequirePermissions('campaigns:write')
  @Post('provision')
  provision(
    @OrgId() orgId: string,
    @Body() body: LeadCampaignActionBodyDto,
  ): Promise<ProvisionHotLeadsResultDto> {
    if (!body.campaignId) {
      throw new BadRequestException('campaignId is required to provision.');
    }
    return this.leads.provision(orgId, body.campaignId) as unknown as Promise<ProvisionHotLeadsResultDto>;
  }

  // Fire the Hot Leads Pipeline webhook (POST {folderId}); omit campaignId for all.
  @RequirePermissions('campaigns:write')
  @Post('run-pipeline')
  runPipeline(
    @OrgId() orgId: string,
    @Body() body: LeadCampaignActionBodyDto,
  ): Promise<RunHotLeadsPipelineResultDto> {
    return this.leads.runPipeline(orgId, body.campaignId) as unknown as Promise<RunHotLeadsPipelineResultDto>;
  }

  // Graduate a lead to an ERP customer.
  @RequirePermissions('customers:write')
  @Post(':id/convert')
  async convert(
    @OrgId() orgId: string,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<LeadDto> {
    const lead = await this.leads.convert(orgId, id);
    setAuditContext(req, {
      entity: 'leads',
      entityId: lead.id,
      action: 'CONVERT',
      after: lead,
    });
    return lead as unknown as LeadDto;
  }

  @RequirePermissions('campaigns:write')
  @Patch(':id')
  async update(
    @OrgId() orgId: string,
    @Param('id') id: string,
    @Body() body: UpdateLeadBodyDto,
    @Req() req: Request,
  ): Promise<LeadDto> {
    const lead = await this.leads.update(orgId, id, body);
    setAuditContext(req, {
      entity: 'leads',
      entityId: lead.id,
      action: 'UPDATE',
      after: lead,
    });
    return lead as unknown as LeadDto;
  }
}
