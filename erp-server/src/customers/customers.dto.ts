import { createZodDto } from 'nestjs-zod';
import {
  CreateCustomerDto as CreateCustomerSchema,
  UpdateCustomerDto as UpdateCustomerSchema,
} from '@evertrust/shared';

export class CreateCustomerBodyDto extends createZodDto(CreateCustomerSchema) {}
export class UpdateCustomerBodyDto extends createZodDto(UpdateCustomerSchema) {}
