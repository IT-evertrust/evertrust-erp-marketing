import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// PATCH /growth/reach/settings — update the per-org Reach send policy. Every field
// is optional (omitted = leave unchanged); an explicit `null` resets that field to
// the product/env default. Validated by the global ZodValidationPipe.
export const updateReachSettingsSchema = z.object({
  // 'test' redirects every Reach send to the test recipient (capped); 'live' sends
  // to the real lead email.
  mode: z.enum(['test', 'live']).optional(),
  // The inbox test-mode sends are redirected to. null = fall back to env default.
  testRecipient: z.string().email().nullable().optional(),
  // Max test-mode sends per delivery run. null = fall back to env default.
  cap: z.number().int().positive().max(1000).nullable().optional(),
});

export type UpdateReachSettingsDto = z.infer<typeof updateReachSettingsSchema>;

export class UpdateReachSettingsBodyDto extends createZodDto(
  updateReachSettingsSchema,
) {}

// POST /growth/reach/settings/test-send — send a one-off sample email to `to` via
// the org's connected mailbox, to verify sending works end-to-end.
export const reachTestSendSchema = z.object({
  to: z.string().email(),
});

export type ReachTestSendDto = z.infer<typeof reachTestSendSchema>;

export class ReachTestSendBodyDto extends createZodDto(reachTestSendSchema) {}
