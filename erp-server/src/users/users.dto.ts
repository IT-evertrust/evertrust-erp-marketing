import { createZodDto } from 'nestjs-zod';
import {
  CreateUserDto as CreateUserSchema,
  SetPasswordDto as SetPasswordSchema,
  UpdateMyNameDto as UpdateMyNameSchema,
  UpdateUserDto as UpdateUserSchema,
} from '@evertrust/shared';

// Validated by the global ZodValidationPipe against the shared schemas.
export class UpdateMyNameBodyDto extends createZodDto(UpdateMyNameSchema) {}
export class UpdateUserBodyDto extends createZodDto(UpdateUserSchema) {}
export class CreateUserBodyDto extends createZodDto(CreateUserSchema) {}
export class SetPasswordBodyDto extends createZodDto(SetPasswordSchema) {}
