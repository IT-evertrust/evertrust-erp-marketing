import { createZodDto } from 'nestjs-zod';
import { CreateRfqDto as CreateRfqSchema } from '@evertrust/shared';

// nestjs-zod request DTO for Phase 5c RFQ dispatch — validated by the global
// ZodValidationPipe against the single-source-of-truth schema in @evertrust/shared.
export class CreateRfqBodyDto extends createZodDto(CreateRfqSchema) {}
