import { Global, Module } from '@nestjs/common';
import { GoogleModule } from '../google/google.module';
import { WorkflowConfigService } from './workflow-config.service';
import { SendersService } from './senders.service';
import { GoogleCalendarService } from './google-calendar.service';

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
//
// GoogleCalendarService is provided + exported here too: the WorkflowConfigController
// (arsenal module) injects it for the read-only /arsenal/config/calendars scan. It now
// depends on GoogleAccountsService (per-org calendar token resolution), so this module
// imports GoogleModule (which exports it). The dependency is ONE-WAY — GoogleModule
// never imports workflow-config — so there is no circular module dependency.
@Global()
@Module({
  imports: [GoogleModule],
  providers: [WorkflowConfigService, SendersService, GoogleCalendarService],
  exports: [WorkflowConfigService, SendersService, GoogleCalendarService],
})
export class WorkflowConfigModule {}
