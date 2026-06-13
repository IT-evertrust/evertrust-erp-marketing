import { createZodDto } from 'nestjs-zod';
import {
  AssignNicheIndustryDto as AssignNicheIndustrySchema,
  CreateNicheTargetDto as CreateNicheTargetSchema,
  NicheTargetBulkDto as NicheTargetBulkSchema,
  UpdateNicheTargetDto as UpdateNicheTargetSchema,
} from '@evertrust/shared';

// nestjs-zod request DTOs for the niche routes — validated by the global
// ZodValidationPipe against the single-source-of-truth schemas in @evertrust/shared.
// Machine: POST /niches/:id/targets/bulk. JWT: POST /niches/:id/targets (manual add),
// PATCH /niche-targets/:id (enable/disable + edit), and PATCH /niches/:id/industry
// (assign / unassign the niche's grouping industry).
export class NicheTargetBulkBodyDto extends createZodDto(NicheTargetBulkSchema) {}
export class CreateNicheTargetBodyDto extends createZodDto(
  CreateNicheTargetSchema,
) {}
export class UpdateNicheTargetBodyDto extends createZodDto(
  UpdateNicheTargetSchema,
) {}
export class AssignNicheIndustryBodyDto extends createZodDto(
  AssignNicheIndustrySchema,
) {}
