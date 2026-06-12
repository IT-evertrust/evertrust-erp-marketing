import { createZodDto } from 'nestjs-zod';
import {
  CreateOutreachMessageDto as CreateOutreachMessageSchema,
  ReplyClassificationDto as ReplyClassificationSchema,
  SuppressionDto as SuppressionSchema,
} from '@evertrust/shared';

// nestjs-zod request DTOs for the outreach machine routes — validated by the global
// ZodValidationPipe against the single-source-of-truth schemas in @evertrust/shared.
export class CreateOutreachMessageBodyDto extends createZodDto(
  CreateOutreachMessageSchema,
) {}
export class ReplyClassificationBodyDto extends createZodDto(
  ReplyClassificationSchema,
) {}
export class SuppressionBodyDto extends createZodDto(SuppressionSchema) {}
