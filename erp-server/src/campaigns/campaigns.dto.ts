import { createZodDto } from 'nestjs-zod';
import { CreateCampaignDto as CreateCampaignSchema } from '@evertrust/shared';

// nestjs-zod request DTO for the Growth-Engine AIM launch — validated by the
// global ZodValidationPipe against the single-source-of-truth schema in
// @evertrust/shared.
export class CreateCampaignBodyDto extends createZodDto(CreateCampaignSchema) {}
