import { createZodDto } from 'nestjs-zod';
import {
  AssignNicheIndustryDto as AssignNicheIndustrySchema,
  CreateNicheDto as CreateNicheSchema,
  CreateNicheTargetDto as CreateNicheTargetSchema,
  NicheTargetBulkDto as NicheTargetBulkSchema,
  UpdateNicheDto as UpdateNicheSchema,
  UpdateNicheTargetDto as UpdateNicheTargetSchema,
} from '@evertrust/shared';

// nestjs-zod request DTOs for the niche routes — validated by the global
// ZodValidationPipe against the single-source-of-truth schemas in @evertrust/shared.
// Machine: POST /niches/:id/targets/bulk. JWT: POST /niches (create niche), PATCH
// /niches/:id (rename), POST /niches/:id/targets (manual add), PATCH
// /niche-targets/:id (enable/disable + edit), and PATCH /niches/:id/industry
// (assign / unassign the niche's grouping industry).
export class CreateNicheBodyDto extends createZodDto(CreateNicheSchema) {}
export class UpdateNicheBodyDto extends createZodDto(UpdateNicheSchema) {}
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
