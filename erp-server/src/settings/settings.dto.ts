import { createZodDto } from 'nestjs-zod';
import { UpdateOrgSettingsDto as UpdateOrgSettingsSchema } from '@evertrust/shared';

// nestjs-zod request DTO for PATCH /growth/settings — validated by the global
// ZodValidationPipe against the single-source-of-truth schema in @evertrust/shared.
export class UpdateOrgSettingsBodyDto extends createZodDto(
  UpdateOrgSettingsSchema,
) {}
