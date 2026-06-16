import {
  BarChart3,
  FileText,
  Heart,
  LayoutDashboard,
  MessageCircle,
  Radio,
  Settings,
  SlidersHorizontal,
  Users,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Permission } from '@evertrust/shared';

// The shell's primary navigation. Each item declares the read permission that
// gates it; the sidebar renders an item only when the user's role grants it,
// except items with `permission: null` (always visible to any authed user, like
// the dashboard landing zone). `group` is the sidebar section label — items
// sharing a group render together under it (kept contiguous + ordered here).
// One source of truth for the nav.
//
// The middle four links are the R.E.A.N. sequence (Reach → Engage → Activate →
// Nurture); `seq` is the small ordinal badge the sidebar renders for them.
export type NavItem = {
  href: string;
  label: string;
  // Key into the `nav` i18n namespace (messages/*.json). The English `label`
  // stays as a fallback for any locale/key that hasn't been translated yet.
  i18nKey: string;
  icon: LucideIcon;
  // null => always shown to authenticated users (dashboard). Otherwise the read
  // permission required to see the link.
  permission: Permission | null;
  // Sidebar section heading; omit for top-level (ungrouped) items.
  group?: string;
  // R.E.A.N. step number — rendered as a small ordinal badge in the rail.
  seq?: number;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', i18nKey: 'dashboard', icon: LayoutDashboard, permission: null },

  // R.E.A.N. sequence: Reach → Engage → Activate → Nurture.
  { href: '/marketing', label: 'Reach', i18nKey: 'reach', icon: Radio, permission: 'campaigns:read', group: 'rean', seq: 1 },
  { href: '/marketing/drafts', label: 'Engage', i18nKey: 'engage', icon: MessageCircle, permission: 'campaigns:read', group: 'rean', seq: 2 },
  { href: '/activate', label: 'Activate', i18nKey: 'activate', icon: Zap, permission: 'campaigns:read', group: 'rean', seq: 3 },
  { href: '/nurture', label: 'Nurture', i18nKey: 'nurture', icon: Heart, permission: 'campaigns:read', group: 'rean', seq: 4 },

  // Insights.
  { href: '/performance', label: 'Analytics', i18nKey: 'analytics', icon: BarChart3, permission: 'campaigns:read', group: 'insights' },
  { href: '/reports', label: 'Reports', i18nKey: 'reports', icon: FileText, permission: 'campaigns:read', group: 'insights' },

  // Settings: General is open to every authed user (permission: null);
  // Configuration is admin-only (admin:config, held by SUPER_ADMIN + ADMIN), and
  // User management is users:manage (Super Admin) — the sidebar hides each link
  // for anyone the API would reject.
  { href: '/settings/general', label: 'General', i18nKey: 'general', icon: Settings, permission: null, group: 'settings' },
  { href: '/settings/configuration', label: 'Configuration', i18nKey: 'configuration', icon: SlidersHorizontal, permission: 'admin:config', group: 'settings' },
  { href: '/users', label: 'User management', i18nKey: 'userManagement', icon: Users, permission: 'users:manage', group: 'settings' },
];
