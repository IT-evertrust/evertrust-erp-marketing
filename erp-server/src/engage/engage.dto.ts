import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { EngageSendBodyDto as EngageSendSchema } from '@evertrust/shared';

// nestjs-zod request DTO for the Engage send route — validated by the global
// ZodValidationPipe against the single-source-of-truth schema in @evertrust/shared.
export class EngageSendBodyDto extends createZodDto(EngageSendSchema) {}

// Body for the CAMPAIGN-centric reply save-draft / send routes: an editable subject
// + body. (subject defaults to empty; body emptiness is enforced per-route.)
export const campaignReplyBodySchema = z.object({
  subject: z.string().optional().default(''),
  body: z.string(),
});

export class CampaignReplyBodyDto extends createZodDto(campaignReplyBodySchema) {}

// Body for setting a campaign's drafting persona (null clears it → default voice).
export const campaignPersonaBodySchema = z.object({
  personaId: z.string().uuid().nullable(),
});
export class CampaignPersonaBodyDto extends createZodDto(
  campaignPersonaBodySchema,
) {}

// Body for adding a "teach the AI" training note to a campaign.
export const trainingNoteBodySchema = z.object({
  note: z.string().min(1).max(500),
});
export class TrainingNoteBodyDto extends createZodDto(trainingNoteBodySchema) {}

// Body for an interactive draft revision ("Write & Fix").
export const redraftBodySchema = z.object({
  instruction: z.string().min(1).max(500),
});
export class RedraftBodyDto extends createZodDto(redraftBodySchema) {}

// Body for creating a new drafting persona (the "+" beside the Draft-persona toggle).
// `name` is the label shown in the picker; `rules` is the voice/style instruction the
// drafter writes in (stored as personas.system_prompt). Both required.
export const createPersonaBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  rules: z.string().trim().min(1).max(8000),
});
export class CreatePersonaBodyDto extends createZodDto(createPersonaBodySchema) {}

// Body for editing an existing persona (name and/or rules). Both optional, but at
// least one must be present, so the picker label and/or the drafting voice can change.
export const updatePersonaBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    rules: z.string().trim().min(1).max(8000).optional(),
  })
  .refine((b) => b.name !== undefined || b.rules !== undefined, {
    message: 'Provide a name or rules to update.',
  });
export class UpdatePersonaBodyDto extends createZodDto(updatePersonaBodySchema) {}
