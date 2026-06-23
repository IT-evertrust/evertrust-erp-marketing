import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { AUTH_COOKIE } from '@/lib/env';

// This is a single internal product (the marketing department's ERP), not a
// multi-tenant SaaS with a public marketing site — so the gate is an ALLOWLIST:
// EVERYTHING requires an authenticated session except the routes below, and any
// future ERP route is protected by default (no denylist to keep in sync). `/`
// itself is gated too — it server-redirects to /overview, so an unauthenticated
// hit bounces straight to /login.
//
// PUBLIC: only the login page. (Next internals + the API + static assets are
// already excluded by the matcher at the bottom.)
const PUBLIC_PREFIXES = ['/login'];

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

  const isPublic = PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (!isPublic && !hasSession && !AUTH_DISABLED) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // NOTE: intentionally NO `/login -> /overview` bounce on cookie presence. The
  // edge can't verify the JWT, so a stale/invalid cookie would ping-pong between
  // /login and /overview forever. /login always renders; a successful login
  // overwrites the cookie, and every other route stays protected by the check above.

  return NextResponse.next();
}

export const config = {
  // Run on app routes, but skip Next internals, the API route handlers, and static assets.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
