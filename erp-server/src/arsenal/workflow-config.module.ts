import { Global, Module } from '@nestjs/common';
import { WorkflowConfigService } from './workflow-config.service';
import { SendersService } from './senders.service';

// Global so WorkflowConfigService is injectable everywhere without re-importing —
// matching its own dependencies (DB + AppConfigService are both global). The
// ArsenalTokenGuard is provided in several feature modules (niches, prospects,
// contracts, outreach, campaigns, arsenal) and now depends on this service, so a
// global provider avoids wiring it into each of them. DB + AppConfigService (its
// deps) are global, so this module needs no imports.
//
// SendersService is provided + exported here too: WorkflowConfigService now depends on
// it to resolve the per-org sender list (so the global provider's deps resolve), and
// the senders CRUD controller (WorkflowConfigController, arsenal module) injects it.
@Global()
@Module({
  providers: [WorkflowConfigService, SendersService],
  exports: [WorkflowConfigService, SendersService],
})
export class WorkflowConfigModule {}
