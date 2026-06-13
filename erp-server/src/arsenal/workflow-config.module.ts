import { Global, Module } from '@nestjs/common';
import { WorkflowConfigService } from './workflow-config.service';

// Global so WorkflowConfigService is injectable everywhere without re-importing —
// matching its own dependencies (DB + AppConfigService are both global). The
// ArsenalTokenGuard is provided in several feature modules (niches, prospects,
// contracts, outreach, campaigns, arsenal) and now depends on this service, so a
// global provider avoids wiring it into each of them. DB + AppConfigService (its
// deps) are global, so this module needs no imports.
@Global()
@Module({
  providers: [WorkflowConfigService],
  exports: [WorkflowConfigService],
})
export class WorkflowConfigModule {}
