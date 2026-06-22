import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  FileText,
  Heart,
  Layers,
  LayoutGrid,
  MessageCircle,
  Radio,
  Settings,
  SlidersHorizontal,
  Users,
  Workflow,
  Zap,
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
    icon: Radio,
    permission: 'campaigns:read',
    group: 'rean',
    step: '01',
  },
  {
    label: 'Engage',
    i18nKey: 'engage',
    href: '/engage',
    icon: MessageCircle,
    permission: 'campaigns:read',
    group: 'rean',
    step: '02',
  },
  {
    label: 'Activate',
    i18nKey: 'activate',
    href: '/activate',
    icon: Zap,
    permission: 'campaigns:read',
    group: 'rean',
    step: '03',
  },
  {
    label: 'Nurture',
    i18nKey: 'nurture',
    href: '/nurture',
    icon: Heart,
    permission: 'campaigns:read',
    group: 'rean',
    step: '04',
  },

  // Insights.
  {
    label: 'Sector',
    i18nKey: 'sector',
    href: '/sector',
    icon: Layers,
    permission: 'campaigns:read',
    group: 'insights',
  },
  {
    label: 'Analytics',
    i18nKey: 'analytics',
    href: '/performance',
    icon: BarChart3,
    permission: 'campaigns:read',
    group: 'insights',
  },
  {
    label: 'Reports',
    i18nKey: 'reports',
    href: '/reports',
    icon: FileText,
    permission: 'campaigns:read',
    group: 'insights',
  },

  // Settings: General is open to every authed user (permission: null);
  // Configuration is admin-only (admin:config), and Users is users:manage —
  // the sidebar hides each link for anyone the API would reject.
  {
    label: 'General',
    i18nKey: 'general',
    href: '/settings/general',
    icon: Settings,
    permission: null,
    group: 'settings',
  },
  {
    label: 'Configuration',
    i18nKey: 'configuration',
    href: '/settings/configuration',
    icon: SlidersHorizontal,
    permission: 'admin:config',
    group: 'settings',
  },
  {
    label: 'User management',
    i18nKey: 'userManagement',
    href: '/users',
    icon: Users,
    permission: 'users:manage',
    group: 'settings',
  },

  // Automation (top-level, ungrouped).
  {
    label: 'Automation',
    i18nKey: 'automation',
    href: '/automation',
    icon: Workflow,
    permission: 'campaigns:read',
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

  const subtitles: Record<string, string> = {
    Overview: 'REPORT · LAST 30 DAYS',
    Reach: '01 · ACQUISITION — SCRAPER · GENERATOR · SENDER',
    Engage: '02 · SORT REPLIES',
    Activate: '03 · BOOKER · RESEARCH · ANALYSIS',
    Nurture: '04 · PIPELINE · CONTRACT',
    Sector: 'SEGMENTATION · TARGETING',
    Analytics: 'PERFORMANCE · METRICS',
    Reports: 'EXPORTS · SUMMARIES',
    General: 'ACCOUNT · DISPLAY · PREFERENCES',
    Configuration: 'SENDING · INTEGRATIONS · BRANDING',
    'User management': 'ROLES · ACCESS',
    Automation: 'WORKFLOWS · TRIGGERS',
  };

  return {
    title: active.label,
    i18nKey: active.i18nKey,
    subtitle: subtitles[active.label] ?? '',
    icon: active.icon,
  };
}
