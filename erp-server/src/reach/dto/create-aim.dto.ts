import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// The create-aim request schema. Validated by the global ZodValidationPipe via the
// createZodDto wrapper below (matches every other module's DTO convention) — no
// inline `.parse()` in the controller. NOTE: this schema lives local to the reach
// module; the house pattern is to keep request schemas in @evertrust/shared as the
// single source of truth (see FLAG in the integration report).
export const createAimSchema = z.object({
  name: z.string().min(1),
  niche: z.string().min(1),
  region: z.string().min(1),
  segment: z.string().optional(),
  source: z.string().optional(),
  // The sending mailbox (info | hanna). Defaults to info.
  sender: z.string().optional(),
  // Per-campaign template placeholders for the org default outreach template:
  //   {{Type}} → targetType, {{IndustryFocus}} → industryFocus, {{TenderFocus}} → tenderFocus.
  targetType: z.string().optional(),
  industryFocus: z.string().optional(),
  tenderFocus: z.string().optional(),
});

export type CreateAimDto = z.infer<typeof createAimSchema>;

// nestjs-zod request DTO — the global ZodValidationPipe validates the body against
// createAimSchema before it reaches the controller handler.
export class CreateAimBodyDto extends createZodDto(createAimSchema) {}

// Body for PATCH /aims/:aimId/auto-send — the Reach Bazooka on/off toggle.
export const setAutoSendSchema = z.object({
  enabled: z.boolean(),
});

export type SetAutoSendDto = z.infer<typeof setAutoSendSchema>;

export class SetAutoSendBodyDto extends createZodDto(setAutoSendSchema) {}
