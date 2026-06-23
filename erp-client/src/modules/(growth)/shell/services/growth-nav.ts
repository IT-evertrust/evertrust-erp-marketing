import type { LucideIcon } from 'lucide-react';
import {
  CalendarDays,
  LayoutGrid,
  Mail,
  Target,
  Workflow,
} from 'lucide-react';

export type GrowthNavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  step?: string;
  group?: 'main' | 'funnel' | 'system';
};

export const GROWTH_NAV_ITEMS: GrowthNavItem[] = [
  {
    label: 'Overview',
    href: '/overview',
    icon: LayoutGrid,
    group: 'main',
  },
  {
    label: 'Reach',
    href: '/reach',
    icon: Target,
    step: '01',
    group: 'funnel',
  },
  {
    label: 'Engage',
    href: '/engage',
    icon: Mail,
    step: '02',
    group: 'funnel',
  },
  {
    label: 'Activate',
    href: '/activate',
    icon: CalendarDays,
    step: '03',
    group: 'funnel',
  },
  {
    label: 'Nurture',
    href: '/nurture',
    icon: Workflow,
    step: '04',
    group: 'funnel',
  },
];

export function getActiveGrowthNavItem(pathname: string) {
  return (
    GROWTH_NAV_ITEMS.find((item) => pathname.startsWith(item.href)) ??
    GROWTH_NAV_ITEMS[0]!
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
  };

  return {
    title: active.label,
    subtitle: subtitles[active.label] ?? '',
    icon: active.icon,
  };
}