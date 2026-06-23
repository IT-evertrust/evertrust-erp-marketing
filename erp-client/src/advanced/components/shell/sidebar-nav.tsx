'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Crosshair } from 'lucide-react';
import { hasPermission, ROLE_LABELS, type MeDto, type Permission } from '@evertrust/shared';
import { useMe } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { NAV_ITEMS, type NavItem } from './nav-items';

// Left-rail navigation for the protected shell. Top: the brand lockup. Middle:
// links gated by the user's role (pure hasPermission — UI affordance only; the
// API still enforces) and grouped into labeled sections, with the R.E.A.N.
// sequence carrying a small ordinal badge. Bottom: the signed-in identity strip.
// Active route is matched by prefix. Mirrors the R.E.A.N. mockup rail.
export function SidebarNav() {
  const pathname = usePathname();
  const { data: user } = useMe();
  const t = useTranslations('nav');
  const can = (p: Permission | null) =>
    p === null || (user ? hasPermission(user.role, p) : false);

  // Visible items, then split into contiguous groups (undefined group => a
  // top-level section with no heading, e.g. Dashboard).
  const sections: { label?: string; items: NavItem[] }[] = [];
  for (const item of NAV_ITEMS) {
    if (!can(item.permission)) continue;
    const last = sections[sections.length - 1];
    if (last && last.label === item.group) last.items.push(item);
    else sections.push({ label: item.group, items: [item] });
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <SidebarBrand />

      <nav className="flex shrink-0 flex-col gap-5 px-3 pb-3" aria-label="Primary">
        {sections.map((section, i) => (
          <div key={section.label ?? `top-${i}`} className="flex flex-col gap-1.5">
            {section.label ? (
              <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                {t(`group.${section.label}`, { default: section.label })}
              </p>
            ) : null}
            <div className="flex flex-col gap-1">
              {section.items.map((item) => (
                <NavLink key={item.href} item={item} pathname={pathname} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="flex-1" />
      <SidebarFooter user={user} />
    </div>
  );
}

// Brand lockup, pinned to the top of the rail (matches the mockup's brand block).
function SidebarBrand() {
  return (
    <Link
      href="/dashboard"
      className="flex shrink-0 items-center gap-2.5 px-4 pb-3 pt-4 transition-opacity hover:opacity-80"
    >
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Crosshair className="size-4" />
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-sm font-semibold tracking-tight">Evertrust</span>
        <span className="text-[11px] text-muted-foreground/70">Growth ERP</span>
      </span>
    </Link>
  );
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const t = useTranslations('nav');
  // A link is active when the current path is under its href — but only if no
  // OTHER nav item is a longer (more specific) prefix. This keeps a parent like
  // "/marketing" from also lighting up when a child like "/marketing/drafts" is
  // the real match, while still highlighting "/marketing" for /marketing/<id>.
  const matches =
    pathname === item.href || pathname.startsWith(`${item.href}/`);
  const hasMoreSpecific = NAV_ITEMS.some(
    (other) =>
      other.href !== item.href &&
      other.href.length > item.href.length &&
      (pathname === other.href || pathname.startsWith(`${other.href}/`)),
  );
  const isActive = matches && !hasMoreSpecific;
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        isActive
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {isActive ? (
        <span
          aria-hidden
          className="absolute inset-y-1.5 left-0 w-0.5 rounded-r bg-primary"
        />
      ) : null}
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{t(item.i18nKey, { default: item.label })}</span>
      {item.seq ? (
        <span
          aria-hidden
          className={cn(
            'ml-auto flex size-[18px] shrink-0 items-center justify-center rounded-[5px] text-[10px] font-bold tabular-nums',
            isActive
              ? 'bg-primary text-primary-foreground'
              : 'border bg-muted text-muted-foreground/70',
          )}
        >
          {item.seq}
        </span>
      ) : null}
    </Link>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

// Bottom-of-rail identity strip: the signed-in user's avatar, name, and role
// (the mockup's "side-foot"). Falls back gracefully before the user loads.
function SidebarFooter({ user }: { user?: MeDto }) {
  return (
    <div className="shrink-0 p-3">
      <div className="flex items-center gap-2.5 rounded-lg border bg-card p-2.5">
        <Avatar className="size-8 shrink-0">
          <AvatarFallback className="bg-gradient-to-br from-sky-500 to-violet-500 text-xs font-bold text-white">
            {user ? initials(user.name) : '··'}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">{user?.name ?? '—'}</p>
          <p className="truncate text-[11px] text-muted-foreground/70">
            {user ? ROLE_LABELS[user.role] : ''}
          </p>
        </div>
      </div>
    </div>
  );
}
