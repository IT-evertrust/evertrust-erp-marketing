import { Controller, Get } from '@nestjs/common';

import { OrgId } from '../../../common/tenant';
import { OverviewService } from './overview.service';

@Controller('growth/overview')
export class OverviewController {
  constructor(private readonly overviewService: OverviewService) {}

  @Get()
  getOverview() {
    return this.overviewService.getOverview();
  }

  // The real Engine Activity feed + alerts for the dashboard.
  @Get('activity')
  getActivity(@OrgId() orgId: string) {
    return this.overviewService.getActivity(orgId);
  }
}
