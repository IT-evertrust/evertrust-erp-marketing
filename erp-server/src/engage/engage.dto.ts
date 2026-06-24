import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { EngageSendBodyDto as EngageSendSchema } from '@evertrust/shared';

// nestjs-zod request DTO for the Engage send route — validated by the global
// ZodValidationPipe against the single-source-of-truth schema in @evertrust/shared.
export class EngageSendBodyDto extends createZodDto(EngageSendSchema) {}

// An optional meeting slot proposed alongside a campaign reply. When present on the
// send route, a tentative Google Calendar event is created for the lead after the
// reply sends (best-effort). ISO-8601 instants (the shape GoogleCalendarReadService
// free-slots returns).
export const proposedSlotSchema = z
  .object({
    start: z.string().datetime(),
    end: z.string().datetime(),
  })
  // Reject an inverted/zero-length window (any campaigns:write caller could POST one).
  // Parse as instants so mixed offsets compare correctly, not lexically.
  .refine((s) => new Date(s.start).getTime() < new Date(s.end).getTime(), {
    message: 'proposedSlot.start must be before proposedSlot.end',
  });

// Body for the CAMPAIGN-centric reply save-draft / send routes: an editable subject
// + body. (subject defaults to empty; body emptiness is enforced per-route.) The
// send route additionally accepts an optional proposedSlot to book a meeting.
export const campaignReplyBodySchema = z.object({
  subject: z.string().optional().default(''),
  body: z.string(),
  proposedSlot: proposedSlotSchema.optional(),
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
