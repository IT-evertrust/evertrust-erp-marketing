import type {
  PriceSource,
  PricingSignal,
  PricingStatus,
  RygFlag,
} from '@evertrust/shared';

// Presentational helpers for the pricing workbench. Pure functions, no React —
// shared by the line-items table, the evidence drawer and the totals panel so
// colors/labels stay consistent. Mirrors the dark-shell conventions in
// tender-format.ts (tinted surface + readable foreground, one class per token).

// The 7 PriceSource values in trust order (highest SOURCE_WEIGHT first). Used to
// order the source <Select> in the add-observation form.
export const PRICE_SOURCE_ORDER: readonly PriceSource[] = [
  'SUPPLIER_QUOTE',
  'OUR_SUBMITTED',
  'COMPETITOR_WINNER',
  'IBAU_HISTORICAL',
  'MANUAL',
  'OUR_BENCHMARK',
  'AI_ESTIMATE',
];

// Human-readable labels for each price source (the enum values are tokens).
export const PRICE_SOURCE_LABEL: Record<PriceSource, string> = {
  SUPPLIER_QUOTE: 'Supplier quote',
  OUR_SUBMITTED: 'Our submitted',
  COMPETITOR_WINNER: 'Competitor winner',
  IBAU_HISTORICAL: 'iBau historical',
  MANUAL: 'Manual',
  OUR_BENCHMARK: 'Our benchmark',
  AI_ESTIMATE: 'AI estimate',
};

// Tailwind badge classes per RYG flag, tuned for the dark shell. GREEN = backed
// by real quotes, YELLOW = mixed evidence, RED = estimate-only / no evidence.
export const RYG_BADGE_CLASS: Record<RygFlag, string> = {
  GREEN: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
  YELLOW: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
  RED: 'bg-rose-500/15 text-rose-300 border-rose-500/25',
};

// Short label per RYG flag for the badge face.
export const RYG_LABEL: Record<RygFlag, string> = {
  GREEN: 'G',
  YELLOW: 'Y',
  RED: 'R',
};

// Human-readable labels for the quality signal.
export const SIGNAL_LABEL: Record<PricingSignal, string> = {
  REAL_QUOTES: 'Real quotes',
  MIXED: 'Mixed',
  ESTIMATE_ONLY: 'Estimate only',
};

// Foreground color per signal for the signal-summary counts (matches the RYG
// mapping REAL_QUOTES→green, MIXED→amber, ESTIMATE_ONLY→rose).
export const SIGNAL_TEXT_CLASS: Record<PricingSignal, string> = {
  REAL_QUOTES: 'text-emerald-400',
  MIXED: 'text-amber-400',
  ESTIMATE_ONLY: 'text-rose-400',
};

// Pricing-status badge classes (DRAFT neutral, REVIEW amber, FINAL emerald).
export const PRICING_STATUS_BADGE_CLASS: Record<PricingStatus, string> = {
  DRAFT: 'bg-slate-500/15 text-slate-300 border-slate-500/25',
  REVIEW: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
  FINAL: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
};

// Format a precision-preserving numeric STRING (money over the wire) as a
// localized currency amount with cents. Dash for null/unparseable.
export function formatMoney(value: string | null, currency: string): string {
  if (value === null) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  try {
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toLocaleString('de-DE')} ${currency}`;
  }
}

// Format the engine's numeric suggestedPrice (a number, or null when there are
// no observations) as a localized currency amount with cents.
export function formatSuggested(
  value: number | null,
  currency: string,
): string {
  if (value === null) return '—';
  return formatMoney(String(value), currency);
}

// Format a 0–95 confidence score as a percentage (the engine already rounds it).
export function formatConfidence(confidence: number): string {
  return `${Math.round(confidence)}%`;
}
