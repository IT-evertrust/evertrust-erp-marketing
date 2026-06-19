import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  ArsenalCallbackDto as ArsenalCallbackSchema,
  RunArsenalDto as RunArsenalSchema,
  UpdateAiEngineDto as UpdateAiEngineSchema,
  UpdateArsenalSettingsDto as UpdateArsenalSettingsSchema,
  UpdateLeadScraperDto as UpdateLeadScraperSchema,
  UpdateWorkflowConfigDto as UpdateWorkflowConfigSchema,
} from '@evertrust/shared';

// nestjs-zod request DTOs for the arsenal routes — validated by the global
// ZodValidationPipe against the single-source-of-truth schemas in @evertrust/shared.
export class RunArsenalBodyDto extends createZodDto(RunArsenalSchema) {}
export class UpdateArsenalSettingsBodyDto extends createZodDto(
  UpdateArsenalSettingsSchema,
) {}
export class ArsenalCallbackBodyDto extends createZodDto(ArsenalCallbackSchema) {}
export class UpdateWorkflowConfigBodyDto extends createZodDto(
  UpdateWorkflowConfigSchema,
) {}
export class UpdateAiEngineBodyDto extends createZodDto(UpdateAiEngineSchema) {}
export class UpdateLeadScraperBodyDto extends createZodDto(
  UpdateLeadScraperSchema,
) {}

// POST /arsenal/config/senders body — upsert a PER-ORG sender keyed by its stable
// org-scoped `key`. `email` must be valid; `label` + `isDefault` are optional. Defined
// locally (not in @evertrust/shared) because it is a server-side write contract for
// the admin CRUD; the resolved READ shape (OrgSenderDto) lives in shared. The
// service layer re-validates key/email regardless of the call path.
export const UpsertOrgSenderSchema = z.object({
  key: z.string().min(1).max(120),
  email: z.string().email().max(320),
  label: z.string().max(120).nullable().optional(),
  isDefault: z.boolean().optional(),
});
export class UpsertOrgSenderBodyDto extends createZodDto(UpsertOrgSenderSchema) {}
