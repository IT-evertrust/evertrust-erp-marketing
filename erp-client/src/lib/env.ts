// Public runtime config. NEXT_PUBLIC_* is inlined at build time, so this resolves
// in both server (middleware) and client bundles. Default keeps local dev working
// without a .env.local present.
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// Name of the httpOnly cookie the API sets on login. Middleware checks for its
// presence to gate protected routes; the logout route handler clears it.
export const AUTH_COOKIE = 'access_token';

// Google OAuth 2.0 Web client ID for Google Identity Services (the "Sign in with
// Google" button). Inlined at build time (NEXT_PUBLIC_*). Empty string when unset
// — the login page then shows a "not configured" notice instead of the button.
export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '';
