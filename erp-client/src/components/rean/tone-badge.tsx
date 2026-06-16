import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// The R.E.A.N. palette's pill-badge tones. These map 1:1 to the mockup's
// `.b-emerald / .b-sky / .b-violet / .b-amber / .b-rose / .b-muted` badge
// classes (style block ~lines 117–123): a tinted bg + matching border + text,
// rendered as a shadcn `outline` Badge so the radius/pill shape is shared.
export const BADGE_TONES = {
  emerald:
    'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  sky: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400',
  violet:
    'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400',
  amber:
    'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  rose: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400',
  muted: 'border-border bg-muted text-muted-foreground',
} as const;

export type ToneName = keyof typeof BADGE_TONES;

// A single, shared pill badge used across every R.E.A.N. page (Reach status
// chips, mailbox scopes, report status, etc.). Extracted from
// settings/configuration-settings.tsx so all pages render the *same* badge.
export function ToneBadge({
  tone,
  className,
  children,
}: {
  tone: ToneName;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Badge
      variant="outline"
      className={cn('font-medium', BADGE_TONES[tone], className)}
    >
      {children}
    </Badge>
  );
}
