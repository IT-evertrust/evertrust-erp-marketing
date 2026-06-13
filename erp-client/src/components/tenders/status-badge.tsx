import { useTranslations } from 'next-intl';
import type { TenderStatus } from '@evertrust/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { STATUS_BADGE_CLASS } from '@/lib/tender-format';

// Color-coded tender status badge. Reads its palette from STATUS_BADGE_CLASS so
// the same colors are used everywhere a status appears (table, board, detail).
// The label is translated at the call site (status.<state>) rather than from the
// shared STATUS_LABEL map.
export function StatusBadge({
  status,
  className,
}: {
  status: TenderStatus;
  className?: string;
}) {
  const t = useTranslations('tenders');
  return (
    <Badge
      variant="outline"
      className={cn('font-medium', STATUS_BADGE_CLASS[status], className)}
    >
      {t(`status.${status}`)}
    </Badge>
  );
}
