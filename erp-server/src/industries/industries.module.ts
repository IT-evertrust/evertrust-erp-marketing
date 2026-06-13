import { Module } from '@nestjs/common';
import { IndustriesController } from './industries.controller';
import { IndustriesService } from './industries.service';

// Industry grouping module. Exports IndustriesService (find-or-create + org-scoped
// CRUD with a delete guard) so other features can resolve/group niches by industry.
// DB is global; the service consumes it. Grouping/search ONLY — never read by lead
// research (the campaign config + arsenal payload are untouched).
@Module({
  controllers: [IndustriesController],
  providers: [IndustriesService],
  exports: [IndustriesService],
})
export class IndustriesModule {}
