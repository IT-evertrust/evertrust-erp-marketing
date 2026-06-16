// Presentational formatters. Pure functions, no React — shared across views so
// value/date/byte formatting stays consistent.

// Format an estimated value (a precision-preserving numeric STRING over the wire)
// as a localized currency amount. Falls back to a dash for null/unparseable.
export function formatValue(value: string | null, currency: string): string {
  if (value === null) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  try {
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    // Unknown currency code — show the raw amount with the code appended.
    return `${n.toLocaleString('de-DE')} ${currency}`;
  }
}

// Format an ISO timestamp as a short date. Dash for null.
export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('de-DE', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// Format a byte count as a compact human size (e.g. "1.2 MB"). Dash for null.
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

// Format an ISO timestamp as date + time (used on the detail page for audit-ish
// fields like created/updated).
export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('de-DE', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
