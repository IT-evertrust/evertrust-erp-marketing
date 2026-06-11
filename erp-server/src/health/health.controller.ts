import { Controller, Get } from '@nestjs/common';
import type { HealthDto } from '@evertrust/shared';
import { Public } from '../auth/decorators/public.decorator';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  // Public liveness/readiness probe. Returns 200 with { status, service, at, db }.
  @Public()
  @Get()
  check(): Promise<HealthDto> {
    return this.health.check();
  }
}
