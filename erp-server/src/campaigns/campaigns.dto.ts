import { createZodDto } from 'nestjs-zod';
import {
  CampaignAssetDto as CampaignAssetSchema,
  CampaignTemplatesBodyDto as CampaignTemplatesSchema,
  CreateCampaignDto as CreateCampaignSchema,
  UpdateCampaignLifecycleDto as UpdateCampaignLifecycleSchema,
} from '@evertrust/shared';

// nestjs-zod request DTOs for the Growth-Engine campaign routes — validated by the
// global ZodValidationPipe against the single-source-of-truth schemas in
// @evertrust/shared.
export class CreateCampaignBodyDto extends createZodDto(CreateCampaignSchema) {}
export class UpdateCampaignLifecycleBodyDto extends createZodDto(
  UpdateCampaignLifecycleSchema,
) {}
export class CampaignAssetBodyDto extends createZodDto(CampaignAssetSchema) {}
export class CampaignTemplatesBodyDto extends createZodDto(
  CampaignTemplatesSchema,
) {}
