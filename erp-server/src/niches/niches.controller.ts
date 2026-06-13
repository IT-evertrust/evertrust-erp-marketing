import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import type {
  ClearResultDto,
  NicheDto,
  NicheListItemDto,
  NicheTargetBulkResultDto,
  NicheTargetDto,
} from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { ArsenalTokenGuard } from '../common/guards/arsenal-token.guard';
import { writeMachineAudit } from '../common/machine-audit';
import { setAuditContext } from '../common/audit-context';
import { OrgId } from '../common/tenant';
import { NichesService } from './niches.service';
import {
  AssignNicheIndustryBodyDto,
  CreateNicheBodyDto,
  CreateNicheTargetBodyDto,
  NicheTargetBulkBodyDto,
  UpdateNicheBodyDto,
} from './niches.dto';

type NicheTargetRow = typeof schema.nicheTargets.$inferSelect;

// Map a niche_target row to its HTTP DTO (timestamp → ISO string).
function toTargetDto(t: NicheTargetRow): NicheTargetDto {
  return {
    id: t.id,
    nicheId: t.nicheId,
    name: t.name,
    slug: t.slug,
    searchHint: t.searchHint,
    source: t.source,
    enabled: t.enabled,
    createdAt: t.createdAt.toISOString(),
  };
}

// Shared niche vocabulary. MIXED auth:
//  - JWT (the UI): GET /niches (now enriched with target/campaign counts for the
//    management list — still a superset of the combobox shape), GET /niches/:id/
//    targets (all targets, both states), POST /niches/:id/targets (add a MANUAL
//    target). All org-scoped from the principal + RBAC, and audited on writes.
//  - MACHINE (the NICHE ANALYTICS workflow): POST /niches/:id/targets/bulk —
//    @Public() + ArsenalTokenGuard, org resolved from the niche row itself; audited
//    (actorType N8N). Its path (/targets/bulk) is unchanged.
@Controller('niches')
export class NichesController {
  constructor(
    private readonly niches: NichesService,
    @Inject(DB) private readonly db: DbClient,
  ) {}

  // The org's niches with rollup counts (the management list). A SUPERSET of the
  // combobox shape (id/name/slug), so the combobox keeps working.
  @RequirePermissions('campaigns:read')
  @Get()
  list(@OrgId() orgId: string): Promise<NicheListItemDto[]> {
    return this.niches.listWithCounts(orgId);
  }

  // Create a niche directly (JWT — the niches-management view, vs. the find-or-create
  // the AIM launch does). org-scoped + audited. A slug clash → 409; a non-null
  // industryId not in the org → 404. Returns the niche read shape.
  @RequirePermissions('campaigns:write')
  @Post()
  async create(
    @OrgId() orgId: string,
    @Body() body: CreateNicheBodyDto,
    @Req() req: Request,
  ): Promise<NicheDto> {
    const row = await this.niches.createNiche(orgId, body.name, body.industryId);
    setAuditContext(req, {
      entity: 'niches',
      entityId: row.id,
      action: 'CREATE',
      after: { name: row.name, slug: row.slug, industryId: row.industryId },
    });
    return { id: row.id, name: row.name, slug: row.slug };
  }

  // A niche's targets for the management view — enabled AND disabled. org-scoped
  // (404 if the niche is not in the caller's org).
  @RequirePermissions('campaigns:read')
  @Get(':id/targets')
  async targets(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<NicheTargetDto[]> {
    const rows = await this.niches.targetsForOrg(orgId, id);
    return rows.map(toTargetDto);
  }

  // Add a MANUAL target to a niche (JWT). org-scoped + audited (campaigns:write).
  // Upserts by (nicheId, slug). Distinct from the machine /targets/bulk route.
  @RequirePermissions('campaigns:write')
  @Post(':id/targets')
  async addTarget(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateNicheTargetBodyDto,
    @Req() req: Request,
  ): Promise<NicheTargetDto> {
    const row = await this.niches.addManualTarget(orgId, id, {
      name: body.name,
      searchHint: body.searchHint,
    });
    setAuditContext(req, {
      entity: 'niche_targets',
      entityId: row.id,
      action: 'CREATE',
      after: { nicheId: row.nicheId, name: row.name, source: row.source },
    });
    return toTargetDto(row);
  }

  // Assign this niche to a grouping industry, or unassign it (industryId = null).
  // org-scoped (404 if the niche — or the target industry — is not in the caller's
  // org) + audited (campaigns:write). Grouping/search ONLY — does NOT touch lead
  // research. Returns the niche read shape.
  @RequirePermissions('campaigns:write')
  @Patch(':id/industry')
  async assignIndustry(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AssignNicheIndustryBodyDto,
    @Req() req: Request,
  ): Promise<NicheDto> {
    const row = await this.niches.assignIndustry(orgId, id, body.industryId);
    setAuditContext(req, {
      entity: 'niches',
      entityId: row.id,
      action: 'UPDATE',
      after: { industryId: row.industryId },
    });
    return { id: row.id, name: row.name, slug: row.slug };
  }

  // Rename a niche (JWT). org-scoped (404 if missing / cross-org) + audited. A slug
  // clash with a sibling niche → 409. Declared AFTER PATCH :id/industry so the more
  // specific industry route is matched first (Nest resolves in declaration order).
  @RequirePermissions('campaigns:write')
  @Patch(':id')
  async rename(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateNicheBodyDto,
    @Req() req: Request,
  ): Promise<NicheDto> {
    const row = await this.niches.renameNiche(orgId, id, body.name);
    setAuditContext(req, {
      entity: 'niches',
      entityId: row.id,
      action: 'UPDATE',
      after: { name: row.name, slug: row.slug },
    });
    return { id: row.id, name: row.name, slug: row.slug };
  }

  // Delete a niche (JWT). org-scoped (404 if missing / cross-org) + audited. BLOCKED
  // with a 409 when the niche still has campaigns or prospects ("reassign or archive
  // them first"); otherwise its own niche_targets are cleared, then the niche row.
  @RequirePermissions('campaigns:write')
  @Delete(':id')
  async remove(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<ClearResultDto> {
    const row = await this.niches.deleteNiche(orgId, id);
    setAuditContext(req, {
      entity: 'niches',
      entityId: row.id,
      action: 'DELETE',
      after: { name: row.name },
    });
    return { deleted: 1 };
  }

  // ---- MACHINE route — @Public() + ArsenalTokenGuard ------------------------

  @Public()
  @UseGuards(ArsenalTokenGuard)
  @Post(':id/targets/bulk')
  async bulkTargets(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: NicheTargetBulkBodyDto,
  ): Promise<NicheTargetBulkResultDto> {
    // Machine route: resolve the niche (and its org) by id only — there is no JWT
    // tenant. 404 if the niche id is unknown.
    const niche = await this.db
      .select()
      .from(schema.niches)
      .where(eq(schema.niches.id, id))
      .limit(1);
    if (!niche[0]) throw new NotFoundException('Niche not found');

    const result = await this.niches.bulkTargets(id, body.targets);
    await writeMachineAudit(this.db, {
      organizationId: niche[0].organizationId,
      entity: 'niche_targets',
      entityId: id,
      action: 'BULK_UPSERT',
      after: { created: result.created, updated: result.updated },
    });
    return {
      created: result.created,
      updated: result.updated,
      targets: result.targets.map(toTargetDto),
    };
  }
}
