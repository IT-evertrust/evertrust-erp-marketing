'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Building2, ChevronRight } from 'lucide-react';
import type { MeDto } from '@evertrust/shared';
import { UserMenu } from './user-menu';
import { NotificationBell } from './notification-bell';
import { LanguageToggle } from './language-toggle';
import { ThemeToggle } from './theme-toggle';
import { LogoutButton } from '@/components/auth/logout-button';
import { NAV_ITEMS } from './nav-items';

// App shell topbar (matches the R.E.A.N. mockup). Left: a breadcrumb
// (Dashboard › <current section>). Right: the EN/DE language toggle, the
// dark/light theme toggle, the active-org chip, the notification bell, and the
// user menu (with logout). When no user is loaded — a stale/invalid session — it
// still renders a plain "Sign out" so logout is ALWAYS reachable.
export function Topbar({ user }: { user?: MeDto }) {
  const pathname = usePathname();
  const t = useTranslations('nav');
  const section = NAV_ITEMS.find(
    (i) => pathname === i.href || pathname.startsWith(`${i.href}/`),
  );
  const isDashboard = section?.href === '/dashboard';

  return (
    <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 w-full items-center gap-3 px-4 md:px-6">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
          <span className={isDashboard ? 'font-medium' : 'text-muted-foreground'}>
            {t('dashboard')}
          </span>
          {section && !isDashboard ? (
            <>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground/40" />
              <span className="truncate font-medium">
                {t(section.i18nKey, { default: section.label })}
              </span>
            </>
          ) : null}
        </nav>

        <div className="flex-1" />

        <LanguageToggle />
        <ThemeToggle />

        {user?.organizationName ? (
          <span className="hidden items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground lg:inline-flex">
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
