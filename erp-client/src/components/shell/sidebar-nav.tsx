'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AlarmClock, Crosshair } from 'lucide-react';
import { hasPermission, type Permission } from '@evertrust/shared';
import { useMe } from '@/hooks/use-auth';
import { useDeadlineRisk } from '@/hooks/use-tenders';
import { useCampaigns } from '@/hooks/use-campaigns';
import { cn } from '@/lib/utils';
import { NAV_ITEMS, type NavItem } from './nav-items';

// Left-rail navigation for the protected shell. Links are gated by the user's
// role (pure hasPermission — UI affordance only; the API still enforces) and
// grouped into labeled sections. The unused mid-rail space is filled with a live
// ops snapshot, and a footer is pinned to the bottom — so the rail reads as a
// full, intentional surface. Active route is matched by prefix.
export function SidebarNav() {
  const pathname = usePathname();
  const { data: user } = useMe();
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
      <nav className="flex shrink-0 flex-col gap-5 p-3" aria-label="Primary">
        {sections.map((section, i) => (
          <div key={section.label ?? `top-${i}`} className="flex flex-col gap-1.5">
            {section.label ? (
              <p className="px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
                {section.label}
              </p>
            ) : null}
            <div className="flex flex-col gap-1 rounded-xl border bg-card/30 p-1.5">
              {section.items.map((item) => (
                <NavLink key={item.href} item={item} pathname={pathname} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Fills the mid-rail gap with at-a-glance operational numbers. */}
      <div className="flex-1" />
      <SidebarSnapshot can={can} />
      <SidebarFooter orgName={user?.organizationName} />
    </div>
  );
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const isActive =
    pathname === item.href || pathname.startsWith(`${item.href}/`);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        isActive
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      )}
    >
      <Icon className="size-4 shrink-0" />
      {item.label}
    </Link>
  );
}

// Live operational snapshot. Each metric is rendered only when the user holds the
// matching read permission, so its query never fires a request the API would 403.
// Counts come from hooks the Dashboard/Tenders/Growth pages already cache.
function SidebarSnapshot({ can }: { can: (p: Permission) => boolean }) {
  const showTenders = can('tenders:read');
  const showCampaigns = can('campaigns:read');
  if (!showTenders && !showCampaigns) return null;

  return (
    <div className="shrink-0 px-3 pb-2">
      <div className="rounded-lg border bg-card/50 p-2.5">
        <p className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
          Snapshot
        </p>
        <div className="flex flex-col gap-0.5">
          {showTenders ? <RiskMetric /> : null}
          {showCampaigns ? <CampaignMetric /> : null}
        </div>
      </div>
    </div>
  );
}

function RiskMetric() {
  const q = useDeadlineRisk();
  const count = q.data?.length ?? 0;
  return (
    <SnapshotRow
      href="/tenders"
      icon={AlarmClock}
      label="At deadline risk"
      value={count}
      loading={q.isLoading}
      accent={count > 0 ? 'text-amber-500' : 'text-foreground'}
    />
  );
}

function CampaignMetric() {
  const q = useCampaigns();
  const live = (q.data ?? []).filter((c) => c.status === 'DEPLOYED').length;
  return (
    <SnapshotRow
      href="/marketing"
      icon={Crosshair}
      label="Live campaigns"
      value={live}
      loading={q.isLoading}
      accent={live > 0 ? 'text-emerald-500' : 'text-foreground'}
    />
  );
}

function SnapshotRow({
  href,
  icon: Icon,
  label,
  value,
  loading,
  accent,
}: {
  href: string;
  icon: typeof AlarmClock;
  label: string;
  value: number;
  loading: boolean;
  accent: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-2 rounded-md px-1 py-1 transition-colors hover:bg-accent/50"
    >
      <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </span>
      <span className={cn('text-sm font-semibold tabular-nums', accent)}>
        {loading ? '–' : value}
      </span>
    </Link>
  );
}

// Bottom-of-rail identity strip: a live status dot + the current org, with the
// product tagline beneath.
function SidebarFooter({ orgName }: { orgName?: string }) {
  return (
    <div className="shrink-0 border-t p-3">
      <div className="flex items-center gap-2 px-2">
        <span className="relative flex size-2 shrink-0" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500/60" />
          <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
        </span>
        <span className="truncate text-xs font-medium">
          {orgName ?? 'Evertrust GmbH'}
        </span>
      </div>
      <p className="px-2 pt-1 text-[11px] text-muted-foreground/50">
        Evertrust Automation OS
      </p>
    </div>
  );
}
