import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// One Read AI meeting to import. `readAiId` is the Read AI ULID (stored as meetings.sessionId,
// unique per org) so re-imports upsert the same row. The transcript is Read AI's; our analysis
// (analysis/persona/score) is never touched on re-import.
export const readAiImportItemSchema = z.object({
  // The Read AI ULID (MCP path). Optional — the Gmail-harvest path has no ULID; rows are
  // keyed on a deterministic (title, date) session key in the repo, not this.
  readAiId: z.string().min(1).optional(),
  title: z.string().optional(),
  company: z.string().optional(),
  contact: z.string().optional(),
  email: z.string().optional(),
  owner: z.string().optional(),
  meetingDate: z.string().optional(), // ISO 8601
  transcript: z.string().optional(),
  summary: z.string().optional(),
  docUrl: z.string().optional(),
});

export const importReadAiSchema = z.object({
  meetings: z.array(readAiImportItemSchema).min(1).max(100),
});

export type ReadAiImportItem = z.infer<typeof readAiImportItemSchema>;
export type ImportReadAiDto = z.infer<typeof importReadAiSchema>;

// nestjs-zod request DTO — the global ZodValidationPipe validates the body against
// importReadAiSchema before it reaches the controller handler (no inline `.parse()`).
export class ImportReadAiBodyDto extends createZodDto(importReadAiSchema) {}

// Body for POST /analyses/:meetingId/analyze — the persona to score through (default =
// the org's first persona). Validated by the global ZodValidationPipe.
export const analyzeMeetingSchema = z.object({
  persona: z.string().trim().min(1).optional(),
});

export type AnalyzeMeetingDto = z.infer<typeof analyzeMeetingSchema>;

export class AnalyzeMeetingBodyDto extends createZodDto(analyzeMeetingSchema) {}
