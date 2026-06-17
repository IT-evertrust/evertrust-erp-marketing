import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { AUTH_COOKIE } from '@/lib/env';

// Route prefixes that require an authenticated session. Add future ERP modules
// here. Everything NOT matched is public — notably `/` (the marketing landing)
// and `/login`. There is intentionally no `/` -> `/dashboard` redirect: the
// landing page is public for everyone, signed in or not.
const PROTECTED_PREFIXES = [
  '/dashboard',
  '/automation',
  '/marketing',
  '/activate',
  '/nurture',
  '/performance',
  '/reports',
  '/users',
  '/settings',
];

// Demo/no-login mode. When NEXT_PUBLIC_AUTH_DISABLED=true the edge stops bouncing
// unauthenticated visitors to /login — paired with the API's AUTH_DISABLED flag
// (which serves a real super-admin for token-less requests) every page renders and
// loads data with nobody signed in. Flip the flag to false to restore the gate.
const AUTH_DISABLED = process.env.NEXT_PUBLIC_AUTH_DISABLED === 'true';

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  // Presence-only check: the cookie value is a JWT we don't verify at the edge
  // (the API is the source of truth). Missing cookie => treat as logged out.
  const hasSession = Boolean(request.cookies.get(AUTH_COOKIE)?.value);

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (isProtected && !hasSession && !AUTH_DISABLED) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // NOTE: intentionally NO `/login -> /dashboard` bounce on cookie presence. The
  // edge can't verify the JWT, so a stale/invalid cookie would ping-pong between
  // /login and /dashboard forever. /login always renders; a successful login
  // overwrites the cookie, and /dashboard stays protected by the check above.

  return NextResponse.next();
}

export const config = {
  // Run on app routes, but skip Next internals, the API route handlers, and static assets.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
