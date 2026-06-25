import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

// Per-org Growth Engine settings (the Settings page). The DB client is global (DbModule)
// so the service injects it directly under the DB token — no imports needed.
@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
