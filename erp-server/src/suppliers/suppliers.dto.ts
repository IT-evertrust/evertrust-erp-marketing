import { createZodDto } from 'nestjs-zod';
import {
  CreateSupplierDto as CreateSupplierSchema,
  UpdateSupplierDto as UpdateSupplierSchema,
} from '@evertrust/shared';

export class CreateSupplierBodyDto extends createZodDto(CreateSupplierSchema) {}
export class UpdateSupplierBodyDto extends createZodDto(UpdateSupplierSchema) {}
