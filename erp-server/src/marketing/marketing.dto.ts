import { createZodDto } from 'nestjs-zod';
import { SendDraftDto as SendDraftSchema } from '@evertrust/shared';

// Validated by the global ZodValidationPipe against the shared schema.
export class SendDraftBodyDto extends createZodDto(SendDraftSchema) {}
