import { createZodDto } from 'nestjs-zod';
import {
  ArsenalCallbackDto as ArsenalCallbackSchema,
  RunArsenalDto as RunArsenalSchema,
  UpdateArsenalSettingsDto as UpdateArsenalSettingsSchema,
} from '@evertrust/shared';

// nestjs-zod request DTOs for the arsenal routes — validated by the global
// ZodValidationPipe against the single-source-of-truth schemas in @evertrust/shared.
export class RunArsenalBodyDto extends createZodDto(RunArsenalSchema) {}
export class UpdateArsenalSettingsBodyDto extends createZodDto(
  UpdateArsenalSettingsSchema,
) {}
export class ArsenalCallbackBodyDto extends createZodDto(ArsenalCallbackSchema) {}
