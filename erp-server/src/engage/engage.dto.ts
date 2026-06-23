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
