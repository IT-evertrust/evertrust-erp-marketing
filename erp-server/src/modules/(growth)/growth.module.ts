import { Module } from '@nestjs/common';

import { OverviewController } from './overview/overview.controller';
import { OverviewRepository } from './overview/overview.repository';
import { OverviewService } from './overview/overview.service';

import { ReachController } from './reach/reach.controller';
import { ReachRepository } from './reach/reach.repository';
import { ReachService } from './reach/reach.service';

import { EngageController } from './engage/engage.controller';
import { EngageRepository } from './engage/engage.repository';
import { EngageService } from './engage/engage.service';

import { ActivateController } from './activate/activate.controller';
import { ActivateRepository } from './activate/activate.repository';
import { ActivateService } from './activate/activate.service';

import { NurtureController } from './nurture/nurture.controller';
import { NurtureRepository } from './nurture/nurture.repository';
import { NurtureService } from './nurture/nurture.service';

@Module({
  controllers: [
    OverviewController,
    ReachController,
    EngageController,
    ActivateController,
    NurtureController,
  ],
  providers: [
    OverviewService,
    OverviewRepository,
    ReachService,
    ReachRepository,
    EngageService,
    EngageRepository,
    ActivateService,
    ActivateRepository,
    NurtureService,
    NurtureRepository,
  ],
  exports: [
    OverviewService,
    ReachService,
    EngageService,
    ActivateService,
    NurtureService,
  ],
})
export class GrowthModule {}