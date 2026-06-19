import { z } from 'zod';

export const sendReplySchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
});

export type SendReplyDto = z.infer<typeof sendReplySchema>;