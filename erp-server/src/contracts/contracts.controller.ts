import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { schema } from '@evertrust/db';
import { ContractStatus, type ContractDto } from '@evertrust/shared';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { OrgId } from '../common/tenant';
import { ArsenalTokenGuard } from '../common/guards/arsenal-token.guard';
import { ContractsService } from './contracts.service';
import { CreateContractBodyDto, UpdateContractBodyDto } from './contracts.dto';

type ContractRow = typeof schema.contracts.$inferSelect;

// Map a contract row to its HTTP DTO (timestamps → ISO strings).
function toDto(r: ContractRow): ContractDto {
  return {
    id: r.id,
    organizationId: r.organizationId,
    leadId: r.leadId,
    customerId: r.customerId,
    campaignId: r.campaignId,
    templateAssetId: r.templateAssetId,
    signingMeetingId: r.signingMeetingId,
    status: r.status,
    driveFileId: r.driveFileId,
    driveUrl: r.driveUrl,
    cooperationTerm: r.cooperationTerm,
    signedAt: r.signedAt ? r.signedAt.toISOString() : null,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
  };
}

// ContractMaker output. MIXED auth (like campaigns.controller):
//  - MACHINE routes (@Public() + ArsenalTokenGuard at the METHOD level): the
//    ContractMaker "already generated?" GET, create + status-flip; org resolved
//    from the linked lead/customer/campaign; audited (actorType N8N) in the service.
//  - JWT route (the UI): GET /contracts/list, org-scoped via req.user.organizationId
//    + RBAC. A distinct sub-path so it does NOT collide with the machine GET the
//    ContractMaker workflow already calls.
@Controller('contracts')
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  // ---- JWT (UI) route — org-scoped ------------------------------------------

  // The org-scoped contract list for the UI. Filters: campaignId, leadId, status,
  // limit. Declared at /list so it does not collide with the machine GET below.
  @RequirePermissions('campaigns:read')
  @Get('list')
  async listForOrg(
    @OrgId() orgId: string,
    @Query('campaignId') campaignIdParam?: string,
    @Query('leadId') leadIdParam?: string,
    @Query('status') statusParam?: string,
    @Query('limit') limitParam?: string,
  ): Promise<ContractDto[]> {
    const status = ContractStatus.safeParse(statusParam);
    const campaignId = z.string().uuid().safeParse(campaignIdParam);
    const leadId = z.string().uuid().safeParse(leadIdParam);
    const limit = Number.parseInt(limitParam ?? '', 10);
    const rows = await this.contracts.listForOrg(orgId, {
      campaignId: campaignId.success ? campaignId.data : undefined,
      leadId: leadId.success ? leadId.data : undefined,
      status: status.success ? status.data : undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    return rows.map(toDto);
  }

  // ---- MACHINE routes — @Public() + ArsenalTokenGuard -----------------------

  // The contract list (newest-first) — ContractMaker's "did I already generate a
  // contract for this lead?" check. Filters: campaignId, leadId, status, limit.
  @Public()
  @UseGuards(ArsenalTokenGuard)
  @Get()
  async list(
    @Query('campaignId') campaignId?: string,
    @Query('leadId') leadId?: string,
    @Query('status') statusParam?: string,
    @Query('limit') limitParam?: string,
  ): Promise<ContractDto[]> {
    const status = ContractStatus.safeParse(statusParam);
    const limit = Number.parseInt(limitParam ?? '', 10);
    const rows = await this.contracts.list({
      campaignId: campaignId || undefined,
      leadId: leadId || undefined,
      status: status.success ? status.data : undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    return rows.map(toDto);
  }

  @Public()
  @UseGuards(ArsenalTokenGuard)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: CreateContractBodyDto): Promise<ContractDto> {
    const row = await this.contracts.create(body);
    return toDto(row);
  }

  @Public()
  @UseGuards(ArsenalTokenGuard)
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateContractBodyDto,
  ): Promise<ContractDto> {
    const row = await this.contracts.update(id, body);
    return toDto(row);
  }
}
