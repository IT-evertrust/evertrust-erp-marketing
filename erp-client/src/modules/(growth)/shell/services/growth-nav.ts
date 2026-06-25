import type { LucideIcon } from 'lucide-react';
import {
  Calendar,
  LayoutGrid,
  Mail,
  Share2,
  SlidersHorizontal,
  Target,
} from 'lucide-react';
import type { Permission } from '@evertrust/shared';

// The GrowthShell's primary navigation — Kobe's minimalist rail, carrying the
// whole app's sections. Each item declares the read permission that gates it
// (mirrors main's `nav-items.ts`); the sidebar renders an item only when the
// user's role grants it, except items with `permission: null` (always visible to
// any authed user, like the Overview landing zone). `group` is the sidebar
// section heading — items sharing a group render together under it (kept
// contiguous + ordered here). One source of truth for the nav.
//
// The R.E.A.N. four (Reach → Engage → Activate → Nurture) carry a small ordinal
// badge via `step`.
export type GrowthNavGroup = 'rean' | 'insights' | 'settings';

export type GrowthNavItem = {
  label: string;
  // Key into the `nav` i18n namespace (messages/*/nav.json). `label` is the
  // English fallback for any key not yet translated.
  i18nKey: string;
  href: string;
  icon: LucideIcon;
  // null => always shown to authenticated users. Otherwise the read permission
  // required to see the link.
  permission: Permission | null;
  // Sidebar section heading; omit for top-level (ungrouped) items.
  group?: GrowthNavGroup;
  // R.E.A.N. step number — rendered as a small ordinal badge in the rail.
  step?: string;
};

export const GROWTH_NAV_ITEMS: GrowthNavItem[] = [
  {
    label: 'Overview',
    i18nKey: 'dashboard',
    href: '/overview',
    icon: LayoutGrid,
    permission: null,
  },

  // R.E.A.N. sequence: Reach → Engage → Activate → Nurture.
  {
    label: 'Reach',
    i18nKey: 'reach',
    href: '/reach',
    icon: Target,
    permission: 'campaigns:read',
    group: 'rean',
    step: '01',
  },
  {
    label: 'Engage',
    i18nKey: 'engage',
    href: '/engage',
    icon: Mail,
    permission: 'campaigns:read',
    group: 'rean',
    step: '02',
  },
  {
    label: 'Activate',
    i18nKey: 'activate',
    href: '/activate',
    icon: Calendar,
    permission: 'campaigns:read',
    group: 'rean',
    step: '03',
  },
  {
    label: 'Nurture',
    i18nKey: 'nurture',
    href: '/nurture',
    icon: Share2,
    permission: 'campaigns:read',
    group: 'rean',
    step: '04',
  },

  // Settings — only Configuration (admin-only). Insights (Sector / Analytics /
  // Reports), the other Settings sub-pages (General / Reach / User management), and
  // Automation are intentionally hidden from the rail for the stripped-down shell.
  {
    label: 'Configuration',
    i18nKey: 'configuration',
    href: '/settings/configuration',
    icon: SlidersHorizontal,
    permission: 'admin:config',
    group: 'settings',
  },
];

// Resolve the nav item for the current path. A path matches an item when it is
// under the item's href, but only if no OTHER item is a longer (more specific)
// prefix — so a parent like "/settings" never steals the highlight from a child
// like "/settings/configuration". `/` and `/dashboard` both map to Overview
// (the landing zone), so the legacy dashboard route lights up Overview.
export function getActiveGrowthNavItem(pathname: string) {
  if (pathname === '/' || pathname === '/dashboard') {
    return GROWTH_NAV_ITEMS[0]!;
  }

  const matches = GROWTH_NAV_ITEMS.filter(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );

  if (matches.length === 0) {
    return GROWTH_NAV_ITEMS[0]!;
  }

  return matches.reduce((best, item) =>
    item.href.length > best.href.length ? item : best,
  );
}

export function getGrowthPageMeta(pathname: string) {
  const active = getActiveGrowthNavItem(pathname);

  // English fallbacks for the topbar subtitle, keyed by the item's i18nKey. The
  // live values come from messages/*/nav.json under `subtitle.<i18nKey>`; the
  // topbar uppercases them via CSS, so these stay readable title-case here.
  const subtitleFallback: Record<string, string> = {
    dashboard: 'Report · All phases · Last 30 days',
    reach: '01 · Acquisition — Scraper · Generator · Sender',
    engage: '02 · Sort replies',
    activate: '03 · Booker · Research · Analysis',
    nurture: '04 · Pipeline · Contract',
    sector: 'Segmentation · Targeting',
    analytics: 'Performance · Metrics',
    reports: 'Exports · Summaries',
    general: 'Account · Display · Preferences',
    reachSettings: 'Reach send policy · Test send',
    configuration: 'Sending · Integrations · Branding',
    userManagement: 'Roles · Access',
    automation: 'Workflows · Triggers',
  };

  return {
    title: active.label,
    i18nKey: active.i18nKey,
    // Key into the `nav` namespace for the topbar subtitle.
    subtitleKey: `subtitle.${active.i18nKey}`,
    subtitle: subtitleFallback[active.i18nKey] ?? '',
    icon: active.icon,
  };
}
