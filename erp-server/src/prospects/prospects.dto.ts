import { createZodDto } from 'nestjs-zod';
import {
  CreateProspectCardDto as CreateProspectCardSchema,
  GraduateProspectDto as GraduateProspectSchema,
  ProspectBulkDto as ProspectBulkSchema,
  UpdateProspectCardDto as UpdateProspectCardSchema,
  UpdateProspectDealDto as UpdateProspectDealSchema,
  UpdateProspectDto as UpdateProspectSchema,
  UpdateProspectStageDto as UpdateProspectStageSchema,
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
// JWT manual pipeline-stage move from the Nurture board (PATCH /prospects/:id/stage).
export class UpdateProspectStageBodyDto extends createZodDto(
  UpdateProspectStageSchema,
) {}
// JWT manual € deal-value set from the Nurture card (PATCH /prospects/:id/deal).
export class UpdateProspectDealBodyDto extends createZodDto(
  UpdateProspectDealSchema,
) {}
// JWT manual blank-deal creation on the Nurture board (POST /prospects/card).
export class CreateProspectCardBodyDto extends createZodDto(
  CreateProspectCardSchema,
) {}
// JWT manual inline-edit of a Nurture card's display fields (PATCH /prospects/:id/card).
export class UpdateProspectCardBodyDto extends createZodDto(
  UpdateProspectCardSchema,
) {}
