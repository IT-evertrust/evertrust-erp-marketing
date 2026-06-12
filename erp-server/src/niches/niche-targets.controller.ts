import {
  Controller,
  Body,
  Delete,
  Param,
  ParseUUIDPipe,
  Patch,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { schema } from '@evertrust/db';
import type { ClearResultDto, NicheTargetDto } from '@evertrust/shared';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { setAuditContext } from '../common/audit-context';
import { OrgId } from '../common/tenant';
import { NichesService } from './niches.service';
import { UpdateNicheTargetBodyDto } from './niches.dto';

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

// Per-target management (JWT only). niche_targets are addressed at the ROOT path
// /niche-targets/:id (not under /niches) because the UI edits a target by its own
// id. Tenancy is inherited via the parent niche (niche_targets has no own
// organizationId), so every op resolves the target → its niche → checks the org.
// All routes are org-scoped + RBAC + audited (actorType USER via AuditInterceptor).
@Controller('niche-targets')
export class NicheTargetsController {
  constructor(private readonly niches: NichesService) {}

  // Enable / disable + edit one target. org-scoped (404 if missing / cross-org),
  // audited. campaigns:write.
  @RequirePermissions('campaigns:write')
  @Patch(':id')
  async update(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateNicheTargetBodyDto,
    @Req() req: Request,
  ): Promise<NicheTargetDto> {
    const { target } = await this.niches.updateTargetForOrg(orgId, id, {
      enabled: body.enabled,
      name: body.name,
      searchHint: body.searchHint,
    });
    setAuditContext(req, {
      entity: 'niche_targets',
      entityId: target.id,
      action: 'UPDATE',
      after: { name: target.name, enabled: target.enabled },
    });
    return toTargetDto(target);
  }

  // Hard-delete one target. org-scoped (404 if missing / cross-org), audited.
  // campaigns:write.
  @RequirePermissions('campaigns:write')
  @Delete(':id')
  async remove(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<ClearResultDto> {
    const result = await this.niches.deleteTargetForOrg(orgId, id);
    setAuditContext(req, {
      entity: 'niche_targets',
      entityId: id,
      action: 'DELETE',
      after: { deleted: result.deleted },
    });
    return { deleted: result.deleted ? 1 : 0 };
  }
}
