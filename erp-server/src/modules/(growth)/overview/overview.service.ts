import { Injectable } from '@nestjs/common';

@Injectable()
export class OverviewService {
  getOverview() {
    return {
      kpis: [],
      funnel: [],
      activity: [],
    };
  }
}