// @evertrust/shared — the Phase 5a pricing engine + pricing DTOs.
// PURE and DETERMINISTIC: no I/O, no clock, no randomness. The API loads
// price_observations and feeds them in; the web UI re-uses the SAME functions so
// suggested price / confidence / signal / risk can never drift between layers.
import { z } from 'zod';

// ---- Pricing enums (single source of truth) ----

// Provenance of a price observation. Mirrors the `price_obs_source` pgEnum in
// @evertrust/db. Kept as a literal union so @evertrust/shared has no DB dep.
export const PriceSource = z.enum([
  'SUPPLIER_QUOTE',
  'MANUAL',
  'AI_ESTIMATE',
  'COMPETITOR_WINNER',
  'OUR_SUBMITTED',
  'OUR_BENCHMARK',
  'IBAU_HISTORICAL',
]);
export type PriceSource = z.infer<typeof PriceSource>;

// Quality signal for a line's price evidence. GREEN/YELLOW/RED tiering of trust.
export const PricingSignal = z.enum(['REAL_QUOTES', 'MIXED', 'ESTIMATE_ONLY']);
export type PricingSignal = z.infer<typeof PricingSignal>;

// Red/Yellow/Green flag derived 1:1 from the PricingSignal.
export const RygFlag = z.enum(['RED', 'YELLOW', 'GREEN']);
export type RygFlag = z.infer<typeof RygFlag>;

// ---- Source weighting ----
// How much each source is trusted (0–100). A single real SUPPLIER_QUOTE (90)
// dominates an AI_ESTIMATE (40): the highest-weight observation sets the price.
export const SOURCE_WEIGHT: Record<PriceSource, number> = {
  SUPPLIER_QUOTE: 90,
  OUR_SUBMITTED: 80,
  COMPETITOR_WINNER: 70,
  IBAU_HISTORICAL: 60,
  MANUAL: 50,
  OUR_BENCHMARK: 45,
  AI_ESTIMATE: 40,
};

// The two "estimate" (non-real) sources. Everything else is a REAL observation.
// A line whose evidence is exclusively these is ESTIMATE_ONLY (confidence-capped).
const ESTIMATE_SOURCES: ReadonlySet<PriceSource> = new Set<PriceSource>([
  'AI_ESTIMATE',
  'OUR_BENCHMARK',
]);

// True for SUPPLIER_QUOTE/OUR_SUBMITTED/COMPETITOR_WINNER/IBAU_HISTORICAL/MANUAL.
export function isRealSource(source: PriceSource): boolean {
  return !ESTIMATE_SOURCES.has(source);
}

// Result of pricing one line item from its observations.
export interface LinePricingResult {
  // null only when there are no observations at all.
  suggestedPrice: number | null;
  // 0–95 integer. Capped at 60 when the signal is ESTIMATE_ONLY.
  confidence: number;
  signal: PricingSignal;
  ryg: RygFlag;
  // true iff the line has at least one REAL observation (signal != ESTIMATE_ONLY).
  backed: boolean;
}

// Map a signal to its RYG flag (REAL→GREEN, MIXED→YELLOW, ESTIMATE_ONLY→RED).
function rygForSignal(signal: PricingSignal): RygFlag {
  if (signal === 'REAL_QUOTES') return 'GREEN';
  if (signal === 'MIXED') return 'YELLOW';
  return 'RED';
}

// Derive a line's suggested price, confidence, quality signal and RYG flag from
// its price observations. DETERMINISTIC and input-order-sensitive on ties:
// observations are treated as NEWEST-FIRST, so among equal-weight sources the
// FIRST one wins. Rules:
//   - no observations            -> null price, 0 confidence, ESTIMATE_ONLY/RED.
//   - any SUPPLIER_QUOTE         -> REAL_QUOTES.
//   - all observations estimate  -> ESTIMATE_ONLY.
//   - otherwise (mixed)          -> MIXED.
//   - suggestedPrice = price of the highest-SOURCE_WEIGHT observation.
//   - confidence = min(bestWeight + min(15, 5*(n-1)), 95); ESTIMATE_ONLY caps 60.
//   - backed = signal != ESTIMATE_ONLY.
export function computeLinePricing(
  obs: { source: PriceSource; price: number }[],
): LinePricingResult {
  if (obs.length === 0) {
    return {
      suggestedPrice: null,
      confidence: 0,
      signal: 'ESTIMATE_ONLY',
      ryg: 'RED',
      backed: false,
    };
  }

  const hasSupplierQuote = obs.some((o) => o.source === 'SUPPLIER_QUOTE');
  const allEstimate = obs.every((o) => !isRealSource(o.source));
  const signal: PricingSignal = hasSupplierQuote
    ? 'REAL_QUOTES'
    : allEstimate
      ? 'ESTIMATE_ONLY'
      : 'MIXED';

  // Highest-weight observation sets the price. Strictly-greater comparison keeps
  // the FIRST of equal-weight ties (inputs are newest-first).
  let best = obs[0]!;
  let bestWeight = SOURCE_WEIGHT[best.source];
  for (const o of obs) {
    const w = SOURCE_WEIGHT[o.source];
    if (w > bestWeight) {
      best = o;
      bestWeight = w;
    }
  }

  const n = obs.length;
  // Each additional corroborating observation adds confidence, up to +15.
  let confidence = bestWeight + Math.min(15, 5 * (n - 1));
  confidence = Math.min(confidence, 95);
  if (signal === 'ESTIMATE_ONLY') confidence = Math.min(confidence, 60);
  confidence = Math.round(confidence);

  return {
    suggestedPrice: best.price,
    confidence,
    signal,
    ryg: rygForSignal(signal),
    backed: signal !== 'ESTIMATE_ONLY',
  };
}

// Result of the tender-level risk assessment.
export interface TenderRiskResult {
  highRisk: boolean;
  // Fraction of lines whose price is NOT backed by a real observation (0–1).
  unbackedRatio: number;
  // Human-readable reasons the tender is flagged high-risk (empty when not).
  reasons: string[];
}

// Assess tender-level pricing risk from its priced lines. HIGH RISK when:
//   - the unbacked-line ratio is >= 0.35 (>=35% of lines are estimate-only), OR
//   - any of the TOP-5 lines by bidGp (the biggest-money positions) is unbacked.
// Money math uses numbers; the caller parses numeric strings before calling.
export function computeTenderRisk(
  lines: { bidGp: number | null; backed: boolean }[],
): TenderRiskResult {
  const total = lines.length;
  if (total === 0) {
    return { highRisk: false, unbackedRatio: 0, reasons: [] };
  }

  const unbackedCount = lines.filter((l) => !l.backed).length;
  const unbackedRatio = unbackedCount / total;

  // Top-5 by bidGp (descending). null bidGp sorts as 0 (no monetary weight).
  const top5 = [...lines]
    .sort((a, b) => (b.bidGp ?? 0) - (a.bidGp ?? 0))
    .slice(0, 5);
  const top5Unbacked = top5.filter((l) => !l.backed).length;

  const reasons: string[] = [];
  if (unbackedRatio >= 0.35) {
    reasons.push(
      `${Math.round(unbackedRatio * 100)}% of lines are estimate-only (>=35% threshold)`,
    );
  }
  if (top5Unbacked > 0) {
    reasons.push(
      `${top5Unbacked} of the top-5 lines by value are unbacked (estimate-only)`,
    );
  }

  return { highRisk: reasons.length > 0, unbackedRatio, reasons };
}

// ============================================================================
// Pricing DTOs (api <-> web contract). Read shapes mirror @evertrust/db rows AS
// THEY ARRIVE OVER HTTP: numeric -> string, timestamp -> ISO string, uuid ->
// string; nullable DB columns are .nullable(). Money stays a STRING in read DTOs
// to preserve numeric precision.
// ============================================================================

// ---- Line items ----

export const LineItemDto = z.object({
  id: z.string().uuid(),
  tenderId: z.string().uuid(),
  sourceDocId: z.string().uuid().nullable(),
  parentId: z.string().uuid().nullable(),
  position: z.string(),
  description: z.string(),
  longText: z.string().nullable(),
  qty: z.string(),
  unit: z.string(),
  spec: z.string().nullable(),
  brand: z.string().nullable(),
  std: z.string().nullable(),
  bidEp: z.string().nullable(),
  bidGp: z.string().nullable(),
});
export type LineItemDto = z.infer<typeof LineItemDto>;

// Create payload. position + description REQUIRED; the rest optional. tenderId is
// taken from the route, never the body. bidGp is server-derived (qty*bidEp), so
// it is NOT settable here.
export const CreateLineItemDto = z.object({
  position: z.string().min(1),
  description: z.string().min(1),
  longText: z.string().optional(),
  qty: z.string().optional(),
  unit: z.string().optional(),
  spec: z.string().optional(),
  brand: z.string().optional(),
  std: z.string().optional(),
  bidEp: z.string().optional(),
});
export type CreateLineItemDto = z.infer<typeof CreateLineItemDto>;

// Partial update of the writable fields. bidGp recomputes server-side when bidEp
// (or qty) changes.
export const UpdateLineItemDto = CreateLineItemDto.partial();
export type UpdateLineItemDto = z.infer<typeof UpdateLineItemDto>;

// ---- Price observations ----

export const PriceObservationDto = z.object({
  id: z.string().uuid(),
  lineItemId: z.string().uuid(),
  supplierId: z.string().uuid().nullable(),
  source: PriceSource,
  price: z.string(),
  currency: z.string(),
  note: z.string().nullable(),
  createdBy: z.string().uuid().nullable(),
  observedAt: z.string(),
  createdAt: z.string(),
});
export type PriceObservationDto = z.infer<typeof PriceObservationDto>;

// Create payload for POST /line-items/:id/observations. lineItemId comes from the
// route; createdBy is the authenticated user. supplierId optional (only supplier
// quotes carry one).
export const CreatePriceObservationDto = z.object({
  source: PriceSource,
  supplierId: z.string().uuid().optional(),
  price: z.string(),
  note: z.string().optional(),
});
export type CreatePriceObservationDto = z.infer<
  typeof CreatePriceObservationDto
>;

// ---- Computed pricing views ----

// One line with its computed pricing (the GET /tenders/:id/pricing per-line row).
export const LinePricingDto = z.object({
  lineItem: LineItemDto,
  suggestedPrice: z.number().nullable(),
  confidence: z.number(),
  signal: PricingSignal,
  ryg: RygFlag,
  backed: z.boolean(),
  observationCount: z.number(),
});
export type LinePricingDto = z.infer<typeof LinePricingDto>;

// Mirrors the pricing_status pgEnum.
export const PricingStatus = z.enum(['DRAFT', 'REVIEW', 'FINAL']);
export type PricingStatus = z.infer<typeof PricingStatus>;

// The whole-tender pricing view: every line's computation + the rolled-up totals,
// risk assessment and signal histogram. subtotal/finalPrice are STRINGS (money).
export const TenderPricingDto = z.object({
  lines: z.array(LinePricingDto),
  subtotal: z.string(),
  marginPct: z.number(),
  finalPrice: z.string(),
  currency: z.string(),
  status: PricingStatus,
  highRisk: z.boolean(),
  unbackedRatio: z.number(),
  riskReasons: z.array(z.string()),
  // Count of lines per quality signal (REAL_QUOTES / MIXED / ESTIMATE_ONLY).
  signalCounts: z.object({
    REAL_QUOTES: z.number(),
    MIXED: z.number(),
    ESTIMATE_ONLY: z.number(),
  }),
});
export type TenderPricingDto = z.infer<typeof TenderPricingDto>;

// Body for PUT /tenders/:id/pricing — the only writable knob is the margin %.
// finalPrice = subtotal * (1 + marginPct/100) is computed server-side.
export const UpsertPricingDto = z.object({
  marginPct: z.number(),
});
export type UpsertPricingDto = z.infer<typeof UpsertPricingDto>;

// ============================================================================
// Phase 5b — Claude price-assist (AI suggests, a human decides; never auto-applies)
// For an unbacked / RED LV line the API asks Claude for a unit-price estimate. The
// result is a SUGGESTION only: a human reviews it and, if they accept, records it
// as an AI_ESTIMATE price observation (source weight 40 → the line stays unbacked /
// RED until a real quote backs it). The model's confidence is 0–1; below
// PRICE_ASSIST_LOW_CONFIDENCE the run is flagged escalated (weak suggestion — get a
// real quote) and the UI warns. Every call is logged to ai_runs for cost/quality
// observability; the suggestion never mutates pricing on its own.
// ============================================================================

// Model-reported confidence (0–1) below which a suggestion is "low confidence":
// the ai_runs row is marked escalated and the UI surfaces a warning.
export const PRICE_ASSIST_LOW_CONFIDENCE = 0.5;

// A Claude price suggestion as returned to the web (POST /line-items/:id/price-assist
// response). unitPrice is a STRING (money precision) for one `unit` of the line, in
// `currency`. lowConfidence mirrors confidence < PRICE_ASSIST_LOW_CONFIDENCE so the
// UI never re-derives the threshold. `model` is the model id that produced it.
export const PriceAssistSuggestionDto = z.object({
  unitPrice: z.string(),
  currency: z.string(),
  confidence: z.number(),
  rationale: z.string(),
  assumptions: z.array(z.string()),
  lowConfidence: z.boolean(),
  model: z.string(),
});
export type PriceAssistSuggestionDto = z.infer<typeof PriceAssistSuggestionDto>;

// Response of POST /line-items/:id/price-assist. configured=false when Claude is not
// wired up (blank ANTHROPIC_API_KEY) — the UI shows a neutral "not configured" notice
// rather than an error. error carries a human-readable model/network failure with
// suggestion=null; the endpoint returns 200 and NEVER throws for an operational model
// failure (failures are exposed, not hidden). A successful call sets suggestion and
// leaves error null.
export const PriceAssistResultDto = z.object({
  configured: z.boolean(),
  suggestion: PriceAssistSuggestionDto.nullable(),
  error: z.string().nullable(),
});
export type PriceAssistResultDto = z.infer<typeof PriceAssistResultDto>;

// ============================================================================
// Phase 5c — Hermes supplier RFQ. The ERP dispatches an RFQ to selected suppliers
// (via the Hermes n8n/Gmail webhook) asking them to quote selected line items of a
// tender. The dispatch is logged (rfqs row); supplier replies come back in as
// SUPPLIER_QUOTE price observations on the right line — the normal evidence path —
// so the pricing engine re-weights them automatically. Mirrors the arsenal_runs
// ERP→n8n hand-off model (DISPATCHED / FAILED); the ERP owns the hand-off only.
// ============================================================================

// Mirrors the rfq_status pgEnum — the ERP→n8n dispatch outcome.
export const RfqStatus = z.enum(['DISPATCHED', 'FAILED']);
export type RfqStatus = z.infer<typeof RfqStatus>;

// Read shape of an rfqs row over HTTP. supplierIds/lineItemIds are the snapshot of
// what was asked; detail is the human-readable webhook outcome; timestamps are ISO.
export const RfqDto = z.object({
  id: z.string().uuid(),
  tenderId: z.string().uuid(),
  supplierIds: z.array(z.string().uuid()),
  lineItemIds: z.array(z.string().uuid()),
  note: z.string().nullable(),
  status: RfqStatus,
  detail: z.string().nullable(),
  dispatchedBy: z.string().uuid().nullable(),
  createdAt: z.string(),
});
export type RfqDto = z.infer<typeof RfqDto>;

// Body for POST /tenders/:tenderId/rfqs. At least one supplier is required;
// lineItemIds is optional (empty = the whole tender — typically the unbacked lines,
// chosen by the caller). note is an optional message to the suppliers. tenderId
// comes from the route; status/detail/dispatchedBy are server-owned.
export const CreateRfqDto = z.object({
  supplierIds: z.array(z.string().uuid()).min(1, 'Pick at least one supplier'),
  lineItemIds: z.array(z.string().uuid()).optional(),
  note: z.string().max(2000).optional(),
});
export type CreateRfqDto = z.infer<typeof CreateRfqDto>;
