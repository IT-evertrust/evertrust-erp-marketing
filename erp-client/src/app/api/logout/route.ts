import { NextResponse } from 'next/server';
import { AUTH_COOKIE } from '@/lib/env';

export const dynamic = 'force-dynamic';

// Clears the web-origin mirror cookie so middleware treats the session as logged
// out. The API has no logout endpoint and its cookie is httpOnly on a different
// origin, so expiring our own copy is the actionable step.
export async function POST(): Promise<NextResponse> {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return res;
}
