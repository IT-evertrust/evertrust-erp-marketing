'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Building2, ChevronRight, Crosshair } from 'lucide-react';
import type { MeDto } from '@evertrust/shared';
import { UserMenu } from './user-menu';
import { NotificationBell } from './notification-bell';
import { LogoutButton } from '@/components/auth/logout-button';
import { NAV_ITEMS } from './nav-items';

// App shell topbar. Left: a brand lockup (links home) + a breadcrumb naming the
// current section (matched by prefix off the nav). Right: the active org chip +
// the user menu (with logout). When no user is loaded — a stale/invalid session —
// it still renders a plain "Sign out" so logout is ALWAYS reachable. Width is
// max-w-7xl to line up with the content area below it.
export function Topbar({ user }: { user?: MeDto }) {
  const pathname = usePathname();
  const section = NAV_ITEMS.find(
    (i) => pathname === i.href || pathname.startsWith(`${i.href}/`),
  );

  return (
    <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 w-full items-center gap-3 px-4 md:px-6">
        <Link
          href="/dashboard"
          className="flex shrink-0 items-center gap-2 transition-opacity hover:opacity-80"
        >
          <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Crosshair className="size-4" />
          </span>
          <span className="hidden text-sm font-semibold tracking-tight sm:inline">
            Evertrust ERP
          </span>
        </Link>

        {section ? (
          <div className="flex min-w-0 items-center gap-1.5 text-sm">
            <ChevronRight className="size-4 shrink-0 text-muted-foreground/40" />
            <span className="truncate font-medium">{section.label}</span>
          </div>
        ) : null}

        <div className="flex-1" />

        {user?.organizationName ? (
          <span className="hidden items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs text-muted-foreground lg:inline-flex">
            <Building2 className="size-3.5 shrink-0" />
            <span className="max-w-[14rem] truncate">{user.organizationName}</span>
          </span>
        ) : null}

        {user ? (
          <>
            <NotificationBell />
            <UserMenu user={user} />
          </>
        ) : (
          <LogoutButton variant="ghost" size="sm" />
        )}
      </div>
    </header>
  );
}
