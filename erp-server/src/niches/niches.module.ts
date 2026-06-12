import { Module } from '@nestjs/common';
import { ArsenalTokenGuard } from '../common/guards/arsenal-token.guard';
import { NichesController } from './niches.controller';
import { NicheTargetsController } from './niche-targets.controller';
import { NichesService } from './niches.service';

// Shared niche vocabulary module. Exports NichesService as the SSOT for niche
// find-or-create + target upsert, consumed by campaigns (launch), arsenal (payload),
// and leads (manual niche resolution). DB is global; the service consumes it.
// NicheTargetsController hosts the JWT per-target management (PATCH/DELETE at the
// root /niche-targets path).
@Module({
  controllers: [NichesController, NicheTargetsController],
  providers: [NichesService, ArsenalTokenGuard],
  exports: [NichesService],
})
export class NichesModule {}
