import { createZodDto } from 'nestjs-zod';
import {
  CreateNicheTargetDto as CreateNicheTargetSchema,
  NicheTargetBulkDto as NicheTargetBulkSchema,
  UpdateNicheTargetDto as UpdateNicheTargetSchema,
} from '@evertrust/shared';

// nestjs-zod request DTOs for the niche routes — validated by the global
// ZodValidationPipe against the single-source-of-truth schemas in @evertrust/shared.
// Machine: POST /niches/:id/targets/bulk. JWT: POST /niches/:id/targets (manual add)
// and PATCH /niche-targets/:id (enable/disable + edit).
export class NicheTargetBulkBodyDto extends createZodDto(NicheTargetBulkSchema) {}
export class CreateNicheTargetBodyDto extends createZodDto(
  CreateNicheTargetSchema,
) {}
export class UpdateNicheTargetBodyDto extends createZodDto(
  UpdateNicheTargetSchema,
) {}
