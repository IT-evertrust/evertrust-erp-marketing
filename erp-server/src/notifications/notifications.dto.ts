import { createZodDto } from 'nestjs-zod';
import { CreateNotificationDto as CreateNotificationSchema } from '@evertrust/shared';

// nestjs-zod request DTO for POST /notifications — validated by the global
// ZodValidationPipe against the single-source-of-truth schema in @evertrust/shared.
export class CreateNotificationBodyDto extends createZodDto(
  CreateNotificationSchema,
) {}
