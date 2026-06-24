import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Body for POST /growth/activate/meetings — the Engage→Activate "Book meeting" handoff.
// Creates a real Google Calendar event (with a Meet link) on the chosen mailbox's
// calendar and records a linked meetings row. `startsAt` is an ISO datetime; the end is
// derived from `durationMinutes`. `accountId` is the google_accounts id to book on (the
// campaign's sender mailbox); omitted = the org's default calendar mailbox.
export const bookMeetingSchema = z.object({
  company: z.string().trim().min(1).max(200),
  contactName: z.string().trim().max(200).optional(),
  clientEmail: z.string().trim().email(),
  startsAt: z.string().min(1),
  durationMinutes: z.number().int().min(5).max(480).optional().default(30),
  title: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(4000).optional(),
  accountId: z.string().uuid().optional(),
});

export class BookMeetingBodyDto extends createZodDto(bookMeetingSchema) {}
