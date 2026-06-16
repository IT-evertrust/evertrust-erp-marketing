import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { PerformanceController } from './performance.controller';
import { PerformanceService } from './performance.service';

// Performance Management System (PMS) — KPI scorecards + executive rollup + the
// AI Management brief (via AiModule's ClaudeService). DB is global; the service
// computes scores from kpi_values + kpi_definitions.
@Module({
  imports: [AiModule],
  controllers: [PerformanceController],
  providers: [PerformanceService],
})
export class PerformanceModule {}
