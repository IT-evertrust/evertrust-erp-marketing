'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { API_URL } from '@/lib/env';
import { getLandingPath } from '@/lib/preferences';

// Google sign-in lands here. The API set its httpOnly session cookie on ITS OWN
// origin and redirected the browser here; the edge middleware runs on the WEB
// origin and can't see that cookie. So we do exactly what password login does:
// pull the token (credentials:'include' replays the API-origin cookie) and POST
// it to /api/session, which writes the web-origin mirror cookie the middleware
// gates on. Then land on the user's chosen page. On any failure, back to /login.
export default function GoogleCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${API_URL}/auth/token`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error('not authenticated');
        const { accessToken } = (await res.json()) as { accessToken: string };
        if (!accessToken) throw new Error('no token');

        await fetch('/api/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: accessToken }),
        });

        if (!cancelled) {
          router.replace(getLandingPath());
          router.refresh();
        }
      } catch {
        if (!cancelled) router.replace('/login?error=google_session');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="flex min-h-svh items-center justify-center gap-2 bg-background text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      <p className="text-sm">Finishing sign-in…</p>
    </main>
  );
}
