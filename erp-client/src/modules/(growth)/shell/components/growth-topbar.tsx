'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { LogoutButton } from '@/components/auth/logout-button';
import { LanguageToggle } from '@/components/shell/language-toggle';
import { NotificationBell } from '@/components/shell/notification-bell';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { UserMenu } from '@/components/shell/user-menu';
import { useMe } from '@/hooks/use-auth';

import { getGrowthPageMeta } from '../services/growth-nav';

// The single masthead for the whole app: page icon + title + subtitle on the
// left, account controls on the right. Pages render NO header of their own — the
// title here is the only one, so there's no Dashboard/Overview double-header.
// Right cluster mirrors main's shell: EN/DE + theme toggles, notifications, and
// the user menu (profile / settings / log out). When the session is stale and no
// user resolves, a plain Sign out stays reachable.
export function GrowthTopbar() {
  const pathname = usePathname();
  const t = useTranslations('nav');
  const { data: user } = useMe();
  const meta = getGrowthPageMeta(pathname);
  const Icon = meta.icon;

  return (
    <header className="sticky top-0 z-10 flex h-20 items-center gap-4 border-b border-border bg-background/80 px-6 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center gap-3">
        <Icon className="h-[26px] w-[26px] stroke-[2] text-foreground" />

        <div>
          <h1 className="text-[30px] font-bold leading-none tracking-[-0.02em] text-foreground">
            {t(meta.i18nKey, { default: meta.title })}
          </h1>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            {t(meta.subtitleKey, { default: meta.subtitle })}
          </div>
        </div>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <LanguageToggle />
        <ThemeToggle />
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
