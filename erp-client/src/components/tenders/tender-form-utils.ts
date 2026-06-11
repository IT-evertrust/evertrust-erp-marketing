import type { CreateTenderDto, UpdateTenderDto } from '@evertrust/shared';

// Sentinel for "no selection" in Radix <Select> (which forbids an empty item
// value). Maps to undefined in the form and is omitted from the payload.
export const NONE = '__none__';

// The form's value shape, matched to CreateTenderDto so zodResolver(CreateTenderDto)
// validates it directly. The three fields that zod would reject as '' (a uuid and
// two ISO datetimes) are kept OPTIONAL and stored as undefined-or-valid — never
// as a half-typed string — so validation passes without a transform layer:
//   - customerId: undefined or a real uuid (set by the <Select>)
//   - *DeadlineAt: undefined or a full ISO string (datetime inputs convert on change)
// Plain optional strings (buyer, niche, estimatedValue, location, currency) may be
// '' transiently; cleanTenderPayload trims them away before submit.
export type TenderFormValues = {
  vergabeId: string;
  source: string;
  title: string;
  buyer: string;
  customerId?: string;
  regime: CreateTenderDto['regime'];
  niche: string;
  estimatedValue: string;
  currency: string;
  isAboveThreshold: boolean;
  questionsDeadlineAt?: string;
  submissionDeadlineAt?: string;
  location: string;
};

// Trim a string; return undefined when empty so optional fields are OMITTED from
// the payload rather than sent as '' (which a min(1)/length(3) rule would reject).
function opt(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

// A <input type="datetime-local"> emits local wall-clock "YYYY-MM-DDTHH:mm" with
// no zone. Convert to a full ISO-8601 UTC string (what *DeadlineAt expects:
// z.string().datetime()). Empty/invalid -> undefined.
export function localInputToIso(value: string): string | undefined {
  const v = value.trim();
  if (!v) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

// Inverse for display: turn a stored ISO string back into the local
// "YYYY-MM-DDTHH:mm" the datetime-local input wants. Empty/invalid -> ''.
export function isoToLocalInput(value: string | undefined): string {
  const v = value?.trim();
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  // Shift by the local tz offset so the sliced ISO reflects local wall-clock.
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

// Build the create payload from form values: required fields verbatim, optional
// strings normalized (empties dropped). Datetimes/customerId/regime already hold
// valid-or-undefined values. The result satisfies CreateTenderDto.
export function cleanTenderPayload(values: TenderFormValues): CreateTenderDto {
  return {
    vergabeId: values.vergabeId.trim(),
    source: values.source.trim(),
    title: values.title.trim(),
    buyer: opt(values.buyer),
    customerId: values.customerId,
    regime: values.regime,
    niche: opt(values.niche),
    estimatedValue: opt(values.estimatedValue),
    currency: opt(values.currency),
    isAboveThreshold: values.isAboveThreshold,
    questionsDeadlineAt: values.questionsDeadlineAt,
    submissionDeadlineAt: values.submissionDeadlineAt,
    location: opt(values.location),
  };
}

// Build a PATCH payload (UpdateTenderDto). Same normalization as create; status
// and organizationId are intentionally never included (not writable here).
export function cleanTenderUpdate(values: TenderFormValues): UpdateTenderDto {
  return cleanTenderPayload(values);
}
