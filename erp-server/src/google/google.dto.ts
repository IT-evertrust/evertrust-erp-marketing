import { createZodDto } from 'nestjs-zod';
import {
  SetDefaultMailboxDto as SetDefaultMailboxSchema,
  SetGoogleDefaultsDto as SetGoogleDefaultsSchema,
  CreateCalendarEventDto as CreateCalendarEventSchema,
  UpdateCalendarEventDto as UpdateCalendarEventSchema,
} from '@evertrust/shared';

// nestjs-zod request DTO for POST /google/accounts/defaults — validated by the
// global ZodValidationPipe against the single-source-of-truth schema in
// @evertrust/shared (each id must be a uuid or null; either field may be omitted).
export class SetGoogleDefaultsBodyDto extends createZodDto(SetGoogleDefaultsSchema) {}

// nestjs-zod request DTO for POST /google/accounts/default — sets the org's SINGLE
// default mailbox (accountId: uuid|null, null clears).
export class SetDefaultMailboxBodyDto extends createZodDto(SetDefaultMailboxSchema) {}

export class CreateCalendarEventBodyDto extends createZodDto(CreateCalendarEventSchema) {}

export class UpdateCalendarEventBodyDto extends createZodDto(UpdateCalendarEventSchema) {}
