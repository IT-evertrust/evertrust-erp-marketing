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
// send route additionally accepts an optional proposedSlot to book a meeting, and an
// optional proposedSlots[] — the set of times offered to the lead in this round, which
// the meeting loop persists so a later scan can resolve the lead's accept/counter reply.
export const campaignReplyBodySchema = z.object({
  subject: z.string().optional().default(''),
  body: z.string(),
  proposedSlot: proposedSlotSchema.optional(),
  proposedSlots: z.array(proposedSlotSchema).max(10).optional(),
});

export class CampaignReplyBodyDto extends createZodDto(campaignReplyBodySchema) {}

// Body for marking a campaign reply BOOKED — the operator confirmed the meeting in
// Activate and hands its id back so the reply threads into the CRM (and, when the
// campaign is attributed, the meeting links to the campaign).
export const campaignReplyBookedBodySchema = z.object({
  meetingId: z.string().uuid(),
});
export class CampaignReplyBookedBodyDto extends createZodDto(
  campaignReplyBookedBodySchema,
) {}

// Body for setting a campaign's drafting persona (null clears it → default voice).
export const campaignPersonaBodySchema = z.object({
  personaId: z.string().uuid().nullable(),
});
export class CampaignPersonaBodyDto extends createZodDto(
  campaignPersonaBodySchema,
) {}

// Body for adding a "teach the AI" training note to a campaign. `personaId` is the
// persona whose prompt the note should adjust (the selected per-email persona);
// null/omitted falls back to the campaign's default persona.
export const trainingNoteBodySchema = z.object({
  note: z.string().min(1).max(500),
  personaId: z.string().uuid().nullish(),
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
