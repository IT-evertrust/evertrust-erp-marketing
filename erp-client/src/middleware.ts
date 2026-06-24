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

// Decode a JWT's payload at the edge WITHOUT verifying its signature — the API
// remains the source of truth for authenticity. We only read `exp` so the gate
// can tell a live session from a stale one. base64url → base64 (+ padding), then
// atob (a global in the Next edge runtime). Returns null on anything malformed.
function decodeJwtPayload(token: string): { exp?: number } | null {
  const parts = token.split('.');
  const payloadPart = parts[1];
  if (parts.length !== 3 || !payloadPart) return null;
  let b64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  try {
    return JSON.parse(atob(b64)) as { exp?: number };
  } catch {
    return null;
  }
}

// A session is "live" only if the cookie holds a well-formed JWT whose `exp` is
// still in the future. Our tokens always carry `exp` (signed with expiresIn), so
// an expired or malformed cookie => logged out. (A token with no `exp` at all is
// treated as live to avoid locking out unexpected token shapes.)
function isSessionLive(token: string | undefined): boolean {
  if (!token) return false;
  const payload = decodeJwtPayload(token);
  if (!payload) return false;
  if (typeof payload.exp !== 'number') return true;
  return payload.exp * 1000 > Date.now();
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  // Validate the cookie's expiry at the edge so an EXPIRED session redirects to
  // /login instead of silently rendering empty pages (every API call 401s). The
  // signature is still verified server-side; we only judge freshness here.
  const token = request.cookies.get(AUTH_COOKIE)?.value;
  const hasSession = isSessionLive(token);

  const isPublic = PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (!isPublic && !hasSession && !AUTH_DISABLED) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    const response = NextResponse.redirect(url);
    // Clear the stale/expired cookie so the next load is clean and re-login isn't
    // short-circuited by a lingering dead token.
    if (token) response.cookies.delete(AUTH_COOKIE);
    return response;
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
