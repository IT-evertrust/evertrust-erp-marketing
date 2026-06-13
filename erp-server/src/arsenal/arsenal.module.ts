import { Module } from '@nestjs/common';
import { ArsenalTokenGuard } from '../common/guards/arsenal-token.guard';
import { ArsenalController } from './arsenal.controller';
import { ArsenalService } from './arsenal.service';
import { ArsenalScheduler } from './arsenal.scheduler';
import { N8nExecutionsService } from './n8n-executions.service';
import { N8nBackfillService } from './n8n-backfill.service';
import { WorkflowConfigController } from './workflow-config.controller';

// Arsenal triggers: manual "Run now" (controller) + the ERP-owned daily Bazooka
// send (scheduler). DB + AppConfigService are global; the service consumes them.
// ArsenalTokenGuard gates the @Public() runs/callback machine route.
// WorkflowConfigService is provided globally (WorkflowConfigModule); the admin
// GET/PUT /arsenal/config endpoints live in WorkflowConfigController here.
@Module({
  controllers: [ArsenalController, WorkflowConfigController],
  providers: [
    ArsenalService,
    ArsenalScheduler,
    N8nExecutionsService,
    N8nBackfillService,
    ArsenalTokenGuard,
  ],
})
export class ArsenalModule {}
