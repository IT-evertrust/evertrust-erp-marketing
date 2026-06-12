import { Module } from '@nestjs/common';
import { ArsenalTokenGuard } from '../common/guards/arsenal-token.guard';
import { LeadsModule } from '../leads/leads.module';
import { ProspectsController } from './prospects.controller';
import { ProspectsService } from './prospects.service';

// Cold-outreach prospect data plane (machine routes only). DB is global; the service
// consumes it. ArsenalTokenGuard gates every (@Public()) route. LeadsModule provides
// LeadsService for the INTERESTED → hot lead graduation.
@Module({
  imports: [LeadsModule],
  controllers: [ProspectsController],
  providers: [ProspectsService, ArsenalTokenGuard],
  exports: [ProspectsService],
})
export class ProspectsModule {}
