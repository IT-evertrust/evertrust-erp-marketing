import { createZodDto } from 'nestjs-zod';
import {
  GraduateProspectDto as GraduateProspectSchema,
  ProspectBulkDto as ProspectBulkSchema,
  UpdateProspectDto as UpdateProspectSchema,
  UpdateProspectStatusDto as UpdateProspectStatusSchema,
} from '@evertrust/shared';

// nestjs-zod request DTOs for the prospect routes — validated by the global
// ZodValidationPipe against the single-source-of-truth schemas in @evertrust/shared.
export class ProspectBulkBodyDto extends createZodDto(ProspectBulkSchema) {}
export class UpdateProspectBodyDto extends createZodDto(UpdateProspectSchema) {}
export class GraduateProspectBodyDto extends createZodDto(
  GraduateProspectSchema,
) {}
// JWT manual status override (PATCH /prospects/:id/status).
export class UpdateProspectStatusBodyDto extends createZodDto(
  UpdateProspectStatusSchema,
) {}
