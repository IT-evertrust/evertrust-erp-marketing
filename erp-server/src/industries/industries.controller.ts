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
  ClearResultDto,
  IndustryDto,
  IndustryListItemDto,
} from '@evertrust/shared';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { setAuditContext } from '../common/audit-context';
import { OrgId } from '../common/tenant';
import { IndustriesService } from './industries.service';
import { CreateIndustryBodyDto, UpdateIndustryBodyDto } from './industries.dto';

// Industry grouping for niches (JWT only). An industry groups niches for
// grouping/search — it is NEVER part of lead research. All routes are org-scoped
// from the principal, RBAC-gated (reads campaigns:read, writes campaigns:write to
// match the niches routes), and audited on writes (actorType USER via the global
// AuditInterceptor).
@Controller('industries')
export class IndustriesController {
  constructor(private readonly industries: IndustriesService) {}

  // The org's industries with their niche-count rollup (the management list).
  @RequirePermissions('campaigns:read')
  @Get()
  list(@OrgId() orgId: string): Promise<IndustryListItemDto[]> {
    return this.industries.listWithCounts(orgId);
  }

  // Create an industry. org-scoped + audited. Deduped by (org, slug).
  @RequirePermissions('campaigns:write')
  @Post()
  async create(
    @OrgId() orgId: string,
    @Body() body: CreateIndustryBodyDto,
    @Req() req: Request,
  ): Promise<IndustryDto> {
    const row = await this.industries.create(orgId, body.name);
    setAuditContext(req, {
      entity: 'industries',
      entityId: row.id,
      action: 'CREATE',
      after: { name: row.name, slug: row.slug },
    });
    return { id: row.id, name: row.name, slug: row.slug };
  }

  // Rename an industry. org-scoped (404 if missing / cross-org) + audited. A slug
  // clash with a sibling industry → 409.
  @RequirePermissions('campaigns:write')
  @Patch(':id')
  async rename(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateIndustryBodyDto,
    @Req() req: Request,
  ): Promise<IndustryDto> {
    const row = await this.industries.rename(orgId, id, body.name);
    setAuditContext(req, {
      entity: 'industries',
      entityId: row.id,
      action: 'UPDATE',
      after: { name: row.name, slug: row.slug },
    });
    return { id: row.id, name: row.name, slug: row.slug };
  }

  // Delete an industry. org-scoped (404 if missing / cross-org) + audited. BLOCKED
  // with a 409 when any niche is still assigned ("Reassign its niches first").
  @RequirePermissions('campaigns:write')
  @Delete(':id')
  async remove(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<ClearResultDto> {
    const row = await this.industries.delete(orgId, id);
    setAuditContext(req, {
      entity: 'industries',
      entityId: row.id,
      action: 'DELETE',
      after: { name: row.name },
    });
    return { deleted: 1 };
  }
}
