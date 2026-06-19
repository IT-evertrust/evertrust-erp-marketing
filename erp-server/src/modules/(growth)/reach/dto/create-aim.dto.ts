import { z } from 'zod';

export const createAimSchema = z.object({
  name: z.string().min(1),
  niche: z.string().min(1),
  region: z.string().min(1),
  segment: z.string().optional(),
  source: z.string().optional(),
});

export type CreateAimDto = z.infer<typeof createAimSchema>;