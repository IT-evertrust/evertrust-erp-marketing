import { createZodDto } from 'nestjs-zod';
import {
  CreateIndustryDto as CreateIndustrySchema,
  UpdateIndustryDto as UpdateIndustrySchema,
} from '@evertrust/shared';

// nestjs-zod request DTOs for the industry routes — validated by the global
// ZodValidationPipe against the single-source-of-truth schemas in @evertrust/shared.
// JWT: POST /industries (create), PATCH /industries/:id (rename). The niche-side
// PATCH /niches/:id/industry body lives in ../niches/niches.dto.ts with its route.
export class CreateIndustryBodyDto extends createZodDto(CreateIndustrySchema) {}
export class UpdateIndustryBodyDto extends createZodDto(UpdateIndustrySchema) {}

