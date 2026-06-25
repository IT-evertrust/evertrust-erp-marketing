import { createZodDto } from 'nestjs-zod';
import {
  CreateContractDto as CreateContractSchema,
  UpdateContractDto as UpdateContractSchema,
} from '@evertrust/shared';

// nestjs-zod request DTOs for the Contract Generator endpoints — validated by the
// global ZodValidationPipe against the single-source-of-truth schemas in
// @evertrust/shared.
export class CreateContractBodyDto extends createZodDto(CreateContractSchema) {}

export class UpdateContractBodyDto extends createZodDto(UpdateContractSchema) {}
