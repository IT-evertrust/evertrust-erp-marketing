'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ChevronsUpDown, LogOut } from 'lucide-react';

import { useLogout, useMe } from '@/hooks/use-auth';
import { GROWTH_NAV_ITEMS } from '../services/growth-nav';

function isActivePath(pathname: string, href: string) {
  return pathname.startsWith(href);
}

export function GrowthSidebar() {
  const pathname = usePathname();

  const mainItems = GROWTH_NAV_ITEMS.filter((item) => item.group === 'main');
  const funnelItems = GROWTH_NAV_ITEMS.filter((item) => item.group === 'funnel');
  const systemItems = GROWTH_NAV_ITEMS.filter((item) => item.group === 'system');

  return (
    <aside className="sticky top-0 flex h-screen w-[240px] shrink-0 flex-col border-r border-[#e4e7eb] bg-white">
      <div className="flex items-center justify-center border-b border-[#e4e7eb] px-3 py-5">
        <div className="text-center">
          <div className="text-[15px] font-bold uppercase tracking-[0.18em] text-[#15171c]">
            Evertrust
          </div>
          <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.18em] text-[#959ca7]">
            Growth Engine
          </div>
        </div>
      </div>

      <nav className="flex flex-1 flex-col overflow-y-auto px-3 py-3">
        <NavSection items={mainItems} pathname={pathname} />

        <div className="px-2 pb-1 pt-4 text-[9.5px] font-bold uppercase tracking-[0.18em] text-[#959ca7]">
          R.E.A.N Funnel
        </div>
        <NavSection items={funnelItems} pathname={pathname} />

        {systemItems.length > 0 ? (
          <>
            <div className="px-2 pb-1 pt-4 text-[9.5px] font-bold uppercase tracking-[0.18em] text-[#959ca7]">
              System
            </div>
            <NavSection items={systemItems} pathname={pathname} />
          </>
        ) : null}
      </nav>

      <SidebarProfile />
    </aside>
  );
}

// Bottom profile block. Click to open a menu with the signed-in user + Log out.
// Logout goes through useLogout(): clears the web-origin session cookie via the
// Next /api/logout route, drops cached user state, and returns to /login.
function SidebarProfile() {
  const { data: me } = useMe();
  const logout = useLogout();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const name = me?.name?.trim() || 'Evertrust';
  const email = me?.email?.trim() || 'Marketing ERP';
  const initials =
    (me?.name || 'ET')
      .split(/\s+/)
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || 'ET';

  return (
    <div ref={ref} className="relative border-t border-[#e4e7eb]">
      {open ? (
        <div className="absolute bottom-full left-3 right-3 mb-2 overflow-hidden rounded-lg border border-[#e4e7eb] bg-white shadow-[0_8px_24px_-8px_rgba(21,23,28,0.25)]">
          <div className="border-b border-[#e4e7eb] px-3 py-2.5">
            <div className="truncate text-[12px] font-bold text-[#15171c]">{name}</div>
            <div className="truncate text-[10px] text-[#959ca7]">{email}</div>
          </div>
          <button
            type="button"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12.5px] font-bold text-[#b42318] transition hover:bg-[#fbeae8] disabled:opacity-50"
          >
            <LogOut className="h-4 w-4 stroke-[1.8]" />
            {logout.isPending ? 'Logging out…' : 'Log out'}
          </button>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 p-3.5 text-left transition hover:bg-[#f6f7f9]"
      >
        <div className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg border border-[#d6dade] bg-[#eceef1] text-[12px] font-bold text-[#15171c]">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-bold leading-tight text-[#15171c]">
            {name}
          </div>
          <div className="truncate text-[10px] text-[#959ca7]">{email}</div>
        </div>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-[#959ca7]" />
      </button>
    </div>
  );
}

type NavSectionProps = {
  items: typeof GROWTH_NAV_ITEMS;
  pathname: string;
};

function NavSection({ items, pathname }: NavSectionProps) {
  return (
    <div className="flex flex-col gap-0.5">
      {items.map((item) => {
        const Icon = item.icon;
        const active = isActivePath(pathname, item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={[
              'relative flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-[13.5px] font-bold no-underline transition',
              active
                ? 'bg-[#eceef1] text-[#15171c]'
                : 'text-[#5b626d] hover:bg-[#f6f7f9] hover:text-[#15171c]',
            ].join(' ')}
          >
            {active ? (
              <span className="absolute -left-3 top-2 bottom-2 w-0.5 rounded-full bg-[#15171c]" />
            ) : null}

            <Icon className="h-4 w-4 shrink-0 stroke-[1.7]" />

            <span className="truncate">{item.label}</span>

            {item.step ? (
              <span className="ml-auto text-[9px] font-bold tracking-[0.1em] text-[#959ca7]">
                {item.step}
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}