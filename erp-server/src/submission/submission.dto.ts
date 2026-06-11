import { createZodDto } from 'nestjs-zod';
import { SubmitTenderDto as SubmitTenderSchema } from '@evertrust/shared';

// nestjs-zod request DTO for Phase 7 submission — validated by the global
// ZodValidationPipe against the single-source-of-truth schema in @evertrust/shared.
export class SubmitTenderBodyDto extends createZodDto(SubmitTenderSchema) {}
