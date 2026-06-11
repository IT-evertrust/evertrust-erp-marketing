import { createZodDto } from 'nestjs-zod';
import {
  CreateApprovalRequestDto as CreateApprovalRequestSchema,
  DecideApprovalDto as DecideApprovalSchema,
} from '@evertrust/shared';

// nestjs-zod request DTOs for the Phase 6 customer-approval gate — validated by the
// global ZodValidationPipe against the single-source-of-truth schemas in
// @evertrust/shared.
export class CreateApprovalRequestBodyDto extends createZodDto(
  CreateApprovalRequestSchema,
) {}
export class DecideApprovalBodyDto extends createZodDto(DecideApprovalSchema) {}
