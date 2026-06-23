import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Body for PATCH /growth/activate/meetings/:eventId — edit a meeting in place. Every
// field is optional (only the provided ones are changed). start/end are ISO datetimes.
export const updateMeetingSchema = z.object({
  title: z.string().optional(),
  description: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
});

export class UpdateMeetingBodyDto extends createZodDto(updateMeetingSchema) {}
