import { createZodDto } from 'nestjs-zod';
import { EngageSendBodyDto as EngageSendSchema } from '@evertrust/shared';

// nestjs-zod request DTO for the Engage send route — validated by the global
// ZodValidationPipe against the single-source-of-truth schema in @evertrust/shared.
export class EngageSendBodyDto extends createZodDto(EngageSendSchema) {}
