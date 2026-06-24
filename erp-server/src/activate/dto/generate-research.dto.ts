import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Body for POST /growth/activate/research/generate — generate/refresh a company's
// client-research dossier (MBTI + interaction context, grounded in internal data).
export const generateResearchSchema = z.object({
  company: z.string().min(1),
  clientEmail: z.string().email().optional(),
});

export class GenerateResearchBodyDto extends createZodDto(generateResearchSchema) {}
