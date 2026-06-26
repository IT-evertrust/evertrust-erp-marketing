import { Module } from '@nestjs/common';
import { ArsenalTokenGuard } from '../common/guards/arsenal-token.guard';
import { ArsenalController } from './arsenal.controller';
import { ArsenalService } from './arsenal.service';
import { ArsenalScheduler } from './arsenal.scheduler';
import { N8nExecutionsService } from './n8n-executions.service';
import { N8nBackfillService } from './n8n-backfill.service';
import { WorkflowConfigController } from './workflow-config.controller';
import { SignatureImageController } from './signature-image.controller';
import { SignatureAssetsService } from './signature-assets.service';

// Arsenal triggers: manual "Run now" (controller) + the ERP-owned daily Bazooka
// send (scheduler). DB + AppConfigService are global; the service consumes them.
// ArsenalTokenGuard gates the @Public() runs/callback machine route.
// WorkflowConfigService is provided globally (WorkflowConfigModule); the admin
// GET/PUT /arsenal/config endpoints live in WorkflowConfigController here.
// SignatureAssetsService backs the per-org signature image: the admin
// POST/DELETE /arsenal/config/signature-image routes (WorkflowConfigController) and
// the @Public() GET /public/signature-image/:id serve (SignatureImageController).
@Module({
  controllers: [
    ArsenalController,
    WorkflowConfigController,
    SignatureImageController,
  ],
  providers: [
    ArsenalService,
    ArsenalScheduler,
    N8nExecutionsService,
    N8nBackfillService,
    ArsenalTokenGuard,
    SignatureAssetsService,
  ],
  // Exported so UsersModule can inject SignatureAssetsService for the per-user
  // signature-image route (it reuses the asset-bytes storage without org_config).
  exports: [SignatureAssetsService],
})
export class ArsenalModule {}
