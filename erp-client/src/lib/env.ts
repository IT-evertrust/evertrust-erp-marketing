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

// When 'true', the Google sign-in popup ALSO requests the Gmail + Calendar connect
// scopes, so ONE sign-in both authenticates AND connects the user's mailbox (the
// server upserts it on the code exchange). OFF by default: deploying this code must
// NOT change the login consent until the OAuth consent screen has those (sensitive)
// scopes registered + verified in Google Cloud Console — otherwise Google rejects the
// request and the login popup fails. Flip to 'true' only after the Console is ready.
export const GOOGLE_CONNECT_ON_LOGIN =
  process.env.NEXT_PUBLIC_GOOGLE_CONNECT_ON_LOGIN === 'true';
