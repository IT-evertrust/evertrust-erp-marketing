import { NextResponse } from 'next/server';
import { AUTH_COOKIE } from '@/lib/env';

// Route handlers are always dynamic — never invoked at build/SSG time.
export const dynamic = 'force-dynamic';

// Mirror cookie: the API sets its own httpOnly `access_token` on ITS origin
// (host-only, so the browser only sends it back to the API). The Next middleware
// runs on the WEB origin and can't see that cookie, so after a successful login
// the client posts the token here and we set a web-origin httpOnly copy. This is
// what middleware checks to gate /dashboard. API calls still authenticate via the
// API's own cookie (credentials:'include').
export async function POST(request: Request): Promise<NextResponse> {
  let token: unknown;
  try {
    ({ token } = (await request.json()) as { token?: unknown });
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  if (typeof token !== 'string' || token.length === 0) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
  return res;
}
