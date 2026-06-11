import { Controller, Get } from '@nestjs/common';
import type { PersonaListDto } from '@evertrust/shared';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PersonasService } from './personas.service';

// Coaching personas (the lens the Sales analysis runs through). Read-only —
// personas are managed as Google Docs in the Drive "AI Personas" folder; the
// ERP lists them via the Sales Agent workflow. Gated campaigns:read.
@Controller('sales/personas')
export class PersonasController {
  constructor(private readonly personas: PersonasService) {}

  @RequirePermissions('campaigns:read')
  @Get()
  list(): Promise<PersonaListDto> {
    return this.personas.list();
  }
}
