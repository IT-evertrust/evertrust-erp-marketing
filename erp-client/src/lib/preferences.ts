// Client-only display preferences, persisted to localStorage (no backend).
// Both surfaces are wired up in Settings → General → Display and have a real
// effect somewhere: landing page changes the post-login redirect; density
// retunes the global Tailwind spacing scale via a `data-density` attribute.
//
// Everything here is SSR-safe: each accessor guards `typeof window` and falls
// back to the default so it can be called during render / in route handlers
// without throwing.

const LANDING_KEY = 'pref:landing';
const DENSITY_KEY = 'pref:density';

// ── Default landing page ─────────────────────────────────────────────────────

// The main routes a user can choose to land on after signing in. The Select in
// the Display card is seeded from this list, and getLandingPath validates the
// stored value against it (so a stale/garbage key can never redirect off-app).
export const LANDING_OPTIONS: { label: string; path: string }[] = [
  { label: 'Dashboard', path: '/dashboard' },
  { label: 'Marketing', path: '/marketing' },
  { label: 'Tenders', path: '/tenders' },
  { label: 'Performance', path: '/performance' },
  { label: 'Users', path: '/users' },
];

const DEFAULT_LANDING = '/dashboard';

// Read the stored landing path, defaulting to /dashboard and validating that it
// is one of the known routes. Safe to call on the server (returns the default).
export function getLandingPath(): string {
  if (typeof window === 'undefined') return DEFAULT_LANDING;
  const stored = window.localStorage.getItem(LANDING_KEY);
  const known = LANDING_OPTIONS.some((o) => o.path === stored);
  return known ? (stored as string) : DEFAULT_LANDING;
}

// Persist a landing path. Ignores values that aren't a known route so the
// control can never store something getLandingPath would reject.
export function setLandingPath(p: string): void {
  if (typeof window === 'undefined') return;
  if (!LANDING_OPTIONS.some((o) => o.path === p)) return;
  window.localStorage.setItem(LANDING_KEY, p);
}

// ── Display density ──────────────────────────────────────────────────────────

export type Density = 'comfortable' | 'compact';

const DEFAULT_DENSITY: Density = 'comfortable';

// Read the stored density, defaulting to "comfortable" (the app's normal
// spacing). Safe to call on the server (returns the default).
export function getDensity(): Density {
  if (typeof window === 'undefined') return DEFAULT_DENSITY;
  return window.localStorage.getItem(DENSITY_KEY) === 'compact'
    ? 'compact'
    : DEFAULT_DENSITY;
}

// Persist a density choice. Applying it to the DOM (so the spacing scale
// actually changes) is the caller's job — see PreferencesBoot and the toggle.
export function setDensity(d: Density): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(DENSITY_KEY, d);
}
