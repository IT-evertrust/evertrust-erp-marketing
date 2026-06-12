import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import type {
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
import { CreateNicheTargetBodyDto, NicheTargetBulkBodyDto } from './niches.dto';

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
