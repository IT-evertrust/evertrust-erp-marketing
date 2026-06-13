import { useTranslations } from 'next-intl';
import { Clock } from 'lucide-react';
import type { DeadlineRiskDto } from '@evertrust/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { DEADLINE_LEVEL_CLASS } from '@/lib/tender-format';

// Phase 6 (R31): a colour-coded deadline-risk badge ("At risk · 2 days left").
// Renders nothing when there is no deadline / the tender is closed (level NONE),
// so callers can drop it in unconditionally. Reads its palette from
// DEADLINE_LEVEL_CLASS so the colour is consistent on the detail page and the
// dashboard worklist. Level label + days phrasing are translated at the call site
// (deadline.level.<level>, deadline.days / deadline.overdue) rather than from the
// shared DEADLINE_LEVEL_LABEL map / formatDaysRemaining helper.
export function DeadlineRiskBadge({
  risk,
  className,
}: {
  risk: DeadlineRiskDto;
  className?: string;
}) {
  const t = useTranslations('tenders');
  if (!risk.hasDeadline || risk.level === 'NONE') return null;
  const days = risk.daysRemaining;
  const phrase =
    days === null
      ? '—'
      : days < 0
        ? t('deadline.overdue', { days: -days })
        : t('deadline.days', { days });
  return (
    <Badge
      variant="outline"
      className={cn('gap-1 font-medium', DEADLINE_LEVEL_CLASS[risk.level], className)}
    >
      <Clock className="size-3" />
      {t(`deadline.level.${risk.level}`)} · {phrase}
    </Badge>
  );
}
