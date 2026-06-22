import { Controller, Get } from '@nestjs/common';

import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { OrgId } from '../common/tenant';
import { OverviewService } from './overview.service';

// The Overview plane (Growth Engine dashboard) for the web UI. JWT-auth + tenant-scoped
// (@OrgId), gated by the campaigns RBAC read permission like Reach/Engage/Activate.
// JwtAuthGuard + PermissionsGuard are global (APP_GUARD) — no @UseGuards here.
@Controller('growth/overview')
export class OverviewController {
  constructor(private readonly overviewService: OverviewService) {}

  @RequirePermissions('campaigns:read')
  @Get()
  getOverview() {
    return this.overviewService.getOverview();
  }

  // The real Engine Activity feed + alerts for the dashboard.
  @RequirePermissions('campaigns:read')
  @Get('activity')
  getActivity(@OrgId() orgId: string) {
    return this.overviewService.getActivity(orgId);
  }
}
