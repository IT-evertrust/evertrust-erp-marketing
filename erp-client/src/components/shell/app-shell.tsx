'use client';

import { useEffect, type ReactNode } from 'react';
import { useLogout, useMe } from '@/hooks/use-auth';
import { Topbar } from './topbar';
import { SidebarNav } from './sidebar-nav';

// The protected app shell (R.E.A.N. layout): a full-height left nav rail beside a
// main column whose topbar sits above the page content. Reused by every module
// page so the chrome and the stale-session handling live in exactly one place.
//
// If /auth/me fails with 401/403 the session cookie is stale; we log out (which
// clears the cookie and returns to /login) rather than bare-redirect, otherwise
// middleware would bounce us right back on the still-present cookie.
export function AppShell({ children }: { children: ReactNode }) {
  const { data: user, isError, error } = useMe();
  const { mutate: doLogout } = useLogout();

  useEffect(() => {
    if (isError && (error.status === 401 || error.status === 403)) {
      doLogout();
    }
  }, [isError, error, doLogout]);

  return (
    <div className="flex min-h-svh bg-background">
      <aside className="hidden w-64 shrink-0 border-r bg-sidebar md:block">
        <div className="sticky top-0 h-svh">
          <SidebarNav />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} />
        <main className="min-w-0 flex-1 px-4 py-8 md:px-8">{children}</main>
      </div>
    </div>
  );
}
