'use client';

import { useEffect, type ReactNode } from 'react';
import { useLogout, useMe } from '@/hooks/use-auth';
import { Topbar } from './topbar';
import { SidebarNav } from './sidebar-nav';

// The protected app shell: topbar (user menu + logout) above a left nav rail and
// the page content. Reused by every ERP module page so the chrome and the
// stale-session handling live in exactly one place.
//
// If /auth/me fails with 401/403 the session cookie is stale; we log out (which
// clears the cookie and returns to /login) rather than bare-redirect, otherwise
// middleware would bounce us right back on the still-present cookie. This mirrors
// the dashboard's defence-in-depth handling.
export function AppShell({ children }: { children: ReactNode }) {
  const { data: user, isError, error } = useMe();
  const { mutate: doLogout } = useLogout();

  useEffect(() => {
    if (isError && (error.status === 401 || error.status === 403)) {
      doLogout();
    }
  }, [isError, error, doLogout]);

  return (
    <div className="flex min-h-svh flex-col bg-muted/40">
      <Topbar user={user} />
      <div className="flex w-full flex-1">
        <aside className="hidden w-60 shrink-0 border-r md:block">
          <div className="sticky top-14 h-[calc(100svh-3.5rem)]">
            <SidebarNav />
          </div>
        </aside>
        <main className="min-w-0 flex-1 px-4 py-8 md:px-8">{children}</main>
      </div>
    </div>
  );
}
