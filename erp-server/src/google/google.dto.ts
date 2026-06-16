import { createZodDto } from 'nestjs-zod';
import { SetGoogleDefaultsDto as SetGoogleDefaultsSchema } from '@evertrust/shared';

// nestjs-zod request DTO for POST /google/accounts/defaults — validated by the
// global ZodValidationPipe against the single-source-of-truth schema in
// @evertrust/shared (each id must be a uuid or null; either field may be omitted).
export class SetGoogleDefaultsBodyDto extends createZodDto(
  SetGoogleDefaultsSchema,
) {}
