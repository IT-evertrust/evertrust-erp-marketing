import { createZodDto } from 'nestjs-zod';
import {
  CreateLeadDto as CreateLeadSchema,
  LeadCampaignActionDto as LeadCampaignActionSchema,
  UpdateLeadDto as UpdateLeadSchema,
} from '@evertrust/shared';

// nestjs-zod request DTOs for the leads routes — validated by the global
// ZodValidationPipe against the single-source-of-truth schemas in @evertrust/shared.
export class CreateLeadBodyDto extends createZodDto(CreateLeadSchema) {}
export class UpdateLeadBodyDto extends createZodDto(UpdateLeadSchema) {}
export class LeadCampaignActionBodyDto extends createZodDto(
  LeadCampaignActionSchema,
) {}
