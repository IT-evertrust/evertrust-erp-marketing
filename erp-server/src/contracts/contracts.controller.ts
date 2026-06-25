import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { ContractDto } from '@evertrust/shared';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { OrgId } from '../common/tenant';
import { CreateContractBodyDto, UpdateContractBodyDto } from './contracts.dto';
import { ContractsService } from './contracts.service';

// The Contract Generator (Contract Assist) REST surface for the web UI. JWT-auth +
// tenant-scoped (@OrgId), guarded by the campaigns RBAC like the sibling Settings
// endpoints (read for GET, write for mutations). JwtAuthGuard + PermissionsGuard are
// global (APP_GUARD) — no @UseGuards here.
@Controller('contracts')
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  // The org's contracts, newest first. Optionally narrowed to one campaign.
  @RequirePermissions('campaigns:read')
  @Get()
  list(
    @OrgId() orgId: string,
    @Query('campaignId', new ParseUUIDPipe({ optional: true }))
    campaignId?: string,
  ): Promise<ContractDto[]> {
    return this.contracts.list(orgId, campaignId);
  }

  // Create a contract for the org. All deal fields are optional; status defaults to
  // GENERATED. Validated by the global ZodValidationPipe against CreateContractDto.
  @RequirePermissions('campaigns:write')
  @Post()
  create(
    @OrgId() orgId: string,
    @Body() body: CreateContractBodyDto,
  ): Promise<ContractDto> {
    return this.contracts.create(orgId, body);
  }

  // Partial update of a contract in this org (404 if not found). Validated against
  // UpdateContractDto.
  @RequirePermissions('campaigns:write')
  @Patch(':id')
  update(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateContractBodyDto,
  ): Promise<ContractDto> {
    return this.contracts.update(orgId, id, body);
  }

  // Delete a contract in this org (404 if not found).
  @RequirePermissions('campaigns:write')
  @Delete(':id')
  remove(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string }> {
    return this.contracts.remove(orgId, id);
  }
}
