'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LogOut } from 'lucide-react';
import { hasPermission, type Permission } from '@evertrust/shared';

import { useLogout, useMe } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';

import { GROWTH_NAV_ITEMS, type GrowthNavItem } from '../services/growth-nav';

// A link is active when the current path is under its href — but only if no
// OTHER nav item is a longer (more specific) prefix, so a parent like
// "/settings" never lights up when a child like "/settings/configuration" is the
// real match. "/" and "/dashboard" both map to Overview (the landing zone).
function isActivePath(pathname: string, href: string) {
  if (href === '/overview' && (pathname === '/' || pathname === '/dashboard')) {
    return true;
  }

  const matches = pathname === href || pathname.startsWith(`${href}/`);
  if (!matches) return false;

  const hasMoreSpecific = GROWTH_NAV_ITEMS.some(
    (other) =>
      other.href !== href &&
      other.href.length > href.length &&
      (pathname === other.href || pathname.startsWith(`${other.href}/`)),
  );

  return !hasMoreSpecific;
}

export function GrowthSidebar() {
  const pathname = usePathname();
  const t = useTranslations('nav');
  const { data: user } = useMe();
  const logout = useLogout();

  const can = (permission: Permission | null) =>
    permission === null || (user ? hasPermission(user.role, permission) : false);

  // Visible items, split into contiguous groups (undefined group => a top-level
  // section with no heading, e.g. Overview / Automation).
  const sections: { label?: GrowthNavItem['group']; items: GrowthNavItem[] }[] = [];
  for (const item of GROWTH_NAV_ITEMS) {
    if (!can(item.permission)) continue;
    const last = sections[sections.length - 1];
    if (last && last.label === item.group) last.items.push(item);
    else sections.push({ label: item.group, items: [item] });
  }

  return (
    <aside className="sticky top-0 flex h-screen w-[240px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex h-20 items-center justify-center border-b border-sidebar-border px-3">
        <div className="text-center">
          <div className="text-[15px] font-bold uppercase tracking-[0.18em] text-sidebar-foreground">
            Evertrust
          </div>
          <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            {t('brandTagline')}
          </div>
        </div>
      </div>

      <nav className="flex flex-1 flex-col overflow-y-auto px-3 py-3">
        {sections.map((section, index) => (
          <div
            key={section.label ?? `top-${index}`}
            className={index > 0 ? 'mt-4' : undefined}
          >
            {section.label ? (
              <div className="px-2 pb-1 text-[9.5px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                {t(`group.${section.label}`, { default: section.label })}
              </div>
            ) : null}
            <NavSection items={section.items} pathname={pathname} t={t} />
          </div>
        ))}
      </nav>

      <div className="flex items-center gap-2.5 border-t border-sidebar-border p-3.5">
        <div className="grid h-[30px] w-[30px] place-items-center rounded-lg border border-sidebar-border bg-sidebar-accent text-[12px] font-bold text-sidebar-foreground">
          ET
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-bold leading-tight text-sidebar-foreground">
            {user?.organizationName ?? 'Evertrust'}
          </div>
          <div className="truncate text-[10px] text-muted-foreground">
            {user?.name ?? 'Marketing ERP'}
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('logout', { default: 'Log out' })}
          title={t('logout', { default: 'Log out' })}
          disabled={logout.isPending}
          onClick={() => logout.mutate()}
          className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
        >
          <LogOut className="size-4" />
        </Button>
      </div>
    </aside>
  );
}

type NavSectionProps = {
  items: GrowthNavItem[];
  pathname: string;
  t: ReturnType<typeof useTranslations>;
};

function NavSection({ items, pathname, t }: NavSectionProps) {
  return (
    <div className="flex flex-col gap-0.5">
      {items.map((item) => {
        const Icon = item.icon;
        const active = isActivePath(pathname, item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={[
              'relative flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-[13.5px] font-bold no-underline transition',
              active
                ? 'bg-sidebar-accent text-sidebar-foreground'
                : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
            ].join(' ')}
          >
            {active ? (
              <span
                aria-hidden
                className="absolute -left-3 top-2 bottom-2 w-0.5 rounded-full bg-foreground"
              />
            ) : null}

            <Icon className="h-4 w-4 shrink-0 stroke-[1.7]" />

            <span className="truncate">{t(item.i18nKey, { default: item.label })}</span>

            {item.step ? (
              <span className="ml-auto text-[9px] font-bold tracking-[0.1em] text-muted-foreground">
                {item.step}
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}
