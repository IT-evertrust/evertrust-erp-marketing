import { Body, Controller, Get, Patch } from '@nestjs/common';
import type { OrgSettingsDto } from '@evertrust/shared';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { OrgId } from '../common/tenant';
import { UpdateOrgSettingsBodyDto } from './settings.dto';
import { SettingsService } from './settings.service';

// The Growth Engine settings plane (the Settings page) for the web UI. JWT-auth +
// tenant-scoped (@OrgId), guarded by the campaigns RBAC like the sibling Reach send-
// settings endpoints (read for GET, write for PATCH). JwtAuthGuard + PermissionsGuard
// are global (APP_GUARD) — no @UseGuards here. Reads/writes the per-org org_config
// columns; values are resolved (stored ?? product default) server-side.
@Controller('growth/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  // The org's effective Growth Engine settings (every field resolved, non-null except
  // senderName/senderEmail).
  @RequirePermissions('campaigns:read')
  @Get()
  getSettings(@OrgId() orgId: string): Promise<OrgSettingsDto> {
    return this.settings.getSettings(orgId);
  }

  // Partial update of the org's Growth Engine settings. Only the provided fields are
  // written. Validated by the global ZodValidationPipe against UpdateOrgSettingsBodyDto.
  // Returns the freshly resolved settings.
  @RequirePermissions('campaigns:write')
  @Patch()
  updateSettings(
    @OrgId() orgId: string,
    @Body() body: UpdateOrgSettingsBodyDto,
  ): Promise<OrgSettingsDto> {
    return this.settings.updateSettings(orgId, body);
  }
}
