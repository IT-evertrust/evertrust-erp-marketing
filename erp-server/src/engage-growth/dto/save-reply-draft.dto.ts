import { z } from 'zod';

export const saveReplyDraftSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
});

export type SaveReplyDraftDto = z.infer<typeof saveReplyDraftSchema>;
