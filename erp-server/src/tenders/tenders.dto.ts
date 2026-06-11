import { createZodDto } from 'nestjs-zod';
import {
  AssignTenderDto as AssignTenderSchema,
  CreateTenderDto as CreateTenderSchema,
  ListTendersQuery as ListTendersQuerySchema,
  TransitionTenderDto as TransitionTenderSchema,
  UpdateTenderDto as UpdateTenderSchema,
} from '@evertrust/shared';

// nestjs-zod request DTOs — validated by the global ZodValidationPipe against the
// single-source-of-truth schemas in @evertrust/shared.
export class CreateTenderBodyDto extends createZodDto(CreateTenderSchema) {}
export class UpdateTenderBodyDto extends createZodDto(UpdateTenderSchema) {}
export class TransitionTenderBodyDto extends createZodDto(
  TransitionTenderSchema,
) {}
export class ListTendersQueryDto extends createZodDto(ListTendersQuerySchema) {}
export class AssignTenderBodyDto extends createZodDto(AssignTenderSchema) {}
