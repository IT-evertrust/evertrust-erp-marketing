// Public runtime config. NEXT_PUBLIC_* is inlined at build time, so this resolves
// in both server (middleware) and client bundles. Default keeps local dev working
// without a .env.local present.
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// Name of the httpOnly cookie the API sets on login. Middleware checks for its
// presence to gate protected routes; the logout route handler clears it.
export const AUTH_COOKIE = 'access_token';
